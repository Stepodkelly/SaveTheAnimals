import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type {
  FloodCollection,
  RoadCollection,
  RoadEdge,
  RoadEdgeFeature,
  RoadNode,
  RouteResult
} from "../types";

type EdgeAnalysisMode = "normal" | "flood";

type QueueItem = {
  nodeId: string;
  cost: number;
  path: string[];
};

export function analyzeEdges(
  roads: RoadCollection,
  floods: FloodCollection,
  mode: EdgeAnalysisMode,
  evidencePenalties: Record<string, number> = {}
): RoadEdge[] {
  return roads.features.map((feature) => {
    const distanceMeters = Math.round(turf.length(feature, { units: "kilometers" }) * 1000);
    const intersectsFlood = mode === "flood" && isFlooded(feature, floods);
    const nearFlood = mode === "flood" && !intersectsFlood && isNearFlood(feature, floods);
    const uncertainPenalty = feature.properties.condition === "uncertain_track" ? distanceMeters : 0;
    const floodPenalty = nearFlood ? distanceMeters * 3 : 0;
    const evidencePenalty = evidencePenalties[feature.properties.id] ?? 0;

    return {
      ...feature.properties,
      geometry: feature.geometry,
      distanceMeters,
      blocked: intersectsFlood,
      nearFlood,
      evidencePenalty,
      cost: distanceMeters + uncertainPenalty + floodPenalty + evidencePenalty
    };
  });
}

export function calculateRoute(
  nodes: RoadNode[],
  edges: RoadEdge[],
  originId: string,
  destinationId: string
): RouteResult {
  const nodeNames = new Map(nodes.map((node) => [node.id, node.name ?? node.id]));
  const queue: QueueItem[] = [{ nodeId: originId, cost: 0, path: [] }];
  const bestCost = new Map<string, number>([[originId, 0]]);
  const previous = new Map<string, string[]>();

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (!current) break;
    if (current.nodeId === destinationId) break;

    for (const edge of edgesForNode(edges, current.nodeId)) {
      if (edge.blocked) continue;
      const nextNode = edge.from === current.nodeId ? edge.to : edge.from;
      const nextCost = current.cost + edge.cost;
      if (nextCost < (bestCost.get(nextNode) ?? Number.POSITIVE_INFINITY)) {
        const nextPath = [...current.path, edge.id];
        bestCost.set(nextNode, nextCost);
        previous.set(nextNode, nextPath);
        queue.push({ nodeId: nextNode, cost: nextCost, path: nextPath });
      }
    }
  }

  const edgeIds = previous.get(destinationId) ?? [];
  if (originId !== destinationId && edgeIds.length === 0) {
    return {
      status: "no_ground_route",
      edgeIds: [],
      distanceMeters: 0,
      riskLevel: "unknown",
      reasons: [
        "Flood-constrained road graph has no connected path to the selected incident.",
        "The result is a no-route finding, not a recommendation to travel off road."
      ],
      geometry: null,
      instructions: [
        "No preliminary ground route found.",
        "Hold at the ranger base and request field verification before dispatch."
      ]
    };
  }

  const routeEdges = edgeIds.map((edgeId) => edges.find((edge) => edge.id === edgeId)).filter(Boolean) as RoadEdge[];
  const distanceMeters = routeEdges.reduce((total, edge) => total + edge.distanceMeters, 0);
  const hasNearFlood = routeEdges.some((edge) => edge.nearFlood);
  const hasUncertainTrack = routeEdges.some((edge) => edge.condition === "uncertain_track");
  const hasEvidencePenalty = routeEdges.some((edge) => edge.evidencePenalty > 0);
  const geometry = mergeLineStrings(routeEdges);
  const riskLevel = hasNearFlood || hasEvidencePenalty ? "high" : hasUncertainTrack ? "moderate" : "low";

  return {
    status: "route_found",
    edgeIds,
    distanceMeters,
    riskLevel,
    reasons: routeReasons(routeEdges),
    geometry,
    instructions: routeEdges.map((edge, index) => {
      const from = index === 0 ? nodeNames.get(edge.from) : nodeNames.get(edge.from) ?? edge.from;
      const to = nodeNames.get(edge.to) ?? edge.to;
      const caution = edge.nearFlood
        ? " Stay alert near observed flood extent."
        : edge.condition === "uncertain_track"
          ? " Track condition is uncertain."
          : "";
      return `${index + 1}. Take ${edge.name} from ${from} toward ${to}.${caution}`;
    })
  };
}

export function routeFeatures(route: RouteResult): FeatureCollection<LineString> {
  if (!route.geometry) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: route.geometry
      }
    ]
  };
}

function edgesForNode(edges: RoadEdge[], nodeId: string) {
  return edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
}

function isFlooded(edge: RoadEdgeFeature, floods: FloodCollection) {
  return floods.features.some((flood) => turf.booleanIntersects(edge, flood));
}

function isNearFlood(edge: RoadEdgeFeature, floods: FloodCollection) {
  return floods.features.some((flood) => {
    const buffered = turf.buffer(flood, 0.45, { units: "kilometers" });
    return buffered ? turf.booleanIntersects(edge, buffered) : false;
  });
}

function mergeLineStrings(edges: RoadEdge[]): LineString {
  const coordinates: LineString["coordinates"] = [];
  edges.forEach((edge, edgeIndex) => {
    edge.geometry.coordinates.forEach((coordinate, coordinateIndex) => {
      if (edgeIndex > 0 && coordinateIndex === 0) return;
      coordinates.push(coordinate);
    });
  });

  return {
    type: "LineString",
    coordinates
  };
}

function routeReasons(edges: RoadEdge[]) {
  const reasons = ["Route follows the preselected demonstration road graph."];
  if (edges.some((edge) => edge.nearFlood)) {
    reasons.push("One or more edges pass near the traced flood extent and are penalized.");
  }
  if (edges.some((edge) => edge.condition === "uncertain_track")) {
    reasons.push("One or more segments are marked as uncertain tracks.");
  }
  if (edges.some((edge) => edge.evidencePenalty > 0)) {
    reasons.push("Operator-approved evidence has increased cost on a mapped asset.");
  }
  return reasons;
}
