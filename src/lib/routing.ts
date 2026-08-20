import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type {
  FloodCollection,
  RoadCollection,
  RoadEdge,
  RoadEdgeFeature,
  RouteMode,
  RoadNode,
  RouteResult
} from "../types";

type EdgeAnalysisMode = "normal" | "flood";
type RouteOptions = {
  mode?: RouteMode;
};

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
  destinationId: string,
  options: RouteOptions = {}
): RouteResult {
  const routingMode = options.mode ?? "best_available";
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
      if (isRouteBlocked(edge, routingMode)) continue;
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
      safetyClass: "no_route",
      routingMode,
      edgeIds: [],
      distanceMeters: 0,
      riskLevel: "unknown",
      reasons: [
        routingMode === "strict_clear"
          ? "Strict-clear routing found no path that avoids blocked roads and direct possible/probable satellite-flood cells."
          : "Flood-constrained road graph has no connected path to the selected incident.",
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
  const hasDirectPossibleFlood = routeEdges.some((edge) => (edge.directPossibleFloodCells ?? 0) > 0);
  const hasDirectProbableFlood = routeEdges.some((edge) => (edge.directProbableFloodCells ?? 0) > 0);
  const hasUncertainTrack = routeEdges.some((edge) => edge.condition === "uncertain_track");
  const hasEvidencePenalty = routeEdges.some((edge) => edge.evidencePenalty > 0);
  const geometry = mergeLineStrings(routeEdges);
  const safetyClass = routeSafetyClass({
    hasDirectProbableFlood,
    hasDirectPossibleFlood,
    hasNearFlood,
    hasUncertainTrack,
    hasEvidencePenalty
  });
  const riskLevel = safetyClass === "unsafe" ? "high" : safetyClass === "caution" ? "moderate" : "low";

  return {
    status: "route_found",
    safetyClass,
    routingMode,
    edgeIds,
    distanceMeters,
    riskLevel,
    reasons: routeReasons(routeEdges),
    geometry,
    instructions: routeEdges.map((edge, index) => {
      const from = index === 0 ? nodeNames.get(edge.from) : nodeNames.get(edge.from) ?? edge.from;
      const to = nodeNames.get(edge.to) ?? edge.to;
      const caution = edge.nearFlood
        ? floodCaution(edge)
        : edge.condition === "uncertain_track"
          ? " Track condition is uncertain."
          : "";
      return `Take ${edge.name} from ${from} toward ${to}.${caution}`;
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

function isRouteBlocked(edge: RoadEdge, routingMode: RouteMode) {
  if (edge.blocked) return true;
  if (routingMode !== "strict_clear") return false;
  return (edge.directProbableFloodCells ?? 0) > 0 || (edge.directPossibleFloodCells ?? 0) > 0;
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
  if (edges.some((edge) => (edge.directProbableFloodCells ?? 0) > 0)) {
    reasons.push("One or more edges directly overlap probable satellite-flood cells.");
  }
  if (edges.some((edge) => (edge.directPossibleFloodCells ?? 0) > 0)) {
    reasons.push("One or more edges directly overlap possible satellite-flood cells.");
  }
  if (edges.some((edge) => edge.nearFlood)) {
    reasons.push("One or more edges touch or pass near satellite-flood cells and are penalized.");
  }
  if (edges.some((edge) => edge.condition === "uncertain_track")) {
    reasons.push("One or more segments are marked as uncertain tracks.");
  }
  if (edges.some((edge) => edge.evidencePenalty > 0)) {
    reasons.push("Operator-approved evidence has increased cost on a mapped asset.");
  }
  return reasons;
}

function routeSafetyClass({
  hasDirectProbableFlood,
  hasDirectPossibleFlood,
  hasNearFlood,
  hasUncertainTrack,
  hasEvidencePenalty
}: {
  hasDirectProbableFlood: boolean;
  hasDirectPossibleFlood: boolean;
  hasNearFlood: boolean;
  hasUncertainTrack: boolean;
  hasEvidencePenalty: boolean;
}) {
  if (hasDirectProbableFlood || hasDirectPossibleFlood) return "unsafe";
  if (hasNearFlood || hasUncertainTrack || hasEvidencePenalty) return "caution";
  return "safe";
}

function floodCaution(edge: RoadEdge) {
  if ((edge.directProbableFloodCells ?? 0) > 0) {
    return " Direct probable satellite-flood overlap; treat as unsafe without field confirmation.";
  }
  if ((edge.directPossibleFloodCells ?? 0) > 0) {
    return " Crosses possible satellite-flood cells; proceed only after field confirmation.";
  }
  return " Passes near satellite-flood cells; verify locally before dispatch.";
}
