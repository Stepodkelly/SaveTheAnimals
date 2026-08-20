import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import type {
  ObservationWindowKey,
  RoadEdge,
  SatelliteFloodMaskCollection,
  SatelliteFloodMaskProperties
} from "../types";

type SatelliteRoadMode = "context" | "constraint";

export function filterSatelliteMask(
  masks: SatelliteFloodMaskCollection,
  activeWindow: ObservationWindowKey
): SatelliteFloodMaskCollection {
  return {
    type: "FeatureCollection",
    features: masks.features.filter((feature) => feature.properties.window === activeWindow)
  };
}

export function applySatelliteMaskToEdges(
  edges: RoadEdge[],
  masks: SatelliteFloodMaskCollection,
  activeWindow: ObservationWindowKey,
  mode: SatelliteRoadMode
): RoadEdge[] {
  const activeFeatures = masks.features.filter((feature) => feature.properties.window === activeWindow);
  if (activeFeatures.length === 0) return edges;

  const probable = activeFeatures.filter((feature) => feature.properties.classification === "probable_flood");
  const possible = activeFeatures.filter((feature) => feature.properties.classification === "possible_flood");

  return edges.map((edge) => {
    const line = turf.lineString(edge.geometry.coordinates);
    const directProbable = probable.filter((feature) => turf.booleanIntersects(line, feature));
    const directPossible = possible.filter((feature) => turf.booleanIntersects(line, feature));
    const bufferedPossible = activeFeatures.filter((feature) => {
      if (directProbable.includes(feature) || directPossible.includes(feature)) return false;
      const buffer = turf.buffer(feature, 0.16, { units: "kilometers" });
      return buffer ? turf.booleanIntersects(line, buffer) : false;
    });

    const touched = [...directProbable, ...directPossible, ...bufferedPossible];
    if (touched.length === 0) return edge;

    const maxProbability = maxFloodProbability(touched);
    const directProbableOverlap = directProbable.length > 0;
    const satelliteBlocked = mode === "constraint" && directProbableOverlap;
    const satellitePenalty = Math.round(edge.distanceMeters * maxProbability * (directProbableOverlap ? 4 : 2));

    return {
      ...edge,
      blocked: edge.blocked || satelliteBlocked,
      nearFlood: edge.nearFlood || touched.length > 0,
      cost: edge.cost + satellitePenalty,
      forecastRisk: Math.max(edge.forecastRisk ?? 0, round(maxProbability)),
      forecastConfidence: Math.max(edge.forecastConfidence ?? 0, directProbableOverlap ? 0.72 : 0.58),
      observedStatus: directProbableOverlap ? "observed_open_water_overlap" : edge.observedStatus ?? "clear_observed",
      directProbableFloodCells: (edge.directProbableFloodCells ?? 0) + directProbable.length,
      directPossibleFloodCells: (edge.directPossibleFloodCells ?? 0) + directPossible.length,
      nearbyFloodCells: (edge.nearbyFloodCells ?? 0) + bufferedPossible.length,
      maxFloodProbability: Math.max(edge.maxFloodProbability ?? 0, round(maxProbability))
    };
  });
}

function maxFloodProbability(features: Array<Feature<Polygon, SatelliteFloodMaskProperties>>) {
  return Math.max(0, ...features.map((feature) => feature.properties.floodProbability));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
