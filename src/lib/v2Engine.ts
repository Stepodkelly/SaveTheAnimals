import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import type {
  RoadEdge,
  V2ReplayCellCollection,
  V2ReplayCellProperties,
  V2ReplayEvaluation,
  V2RoadRiskSegment,
  V2ScoredCellCollection,
  V2ScoredCellProperties
} from "../types";

const REPLAY_ID = "amboseli-2026-march";
const AS_OF = "2026-03-10T00:00:00Z";
const VALID_AT = "2026-03-16T00:00:00Z";
const MANIFEST_ID = "manifest-amboseli-2026-march-replay-v1";
const WET_THRESHOLD = 0.5;
const ROAD_BLOCK_THRESHOLD = 0.65;

export function evaluateV2Replay(cells: V2ReplayCellCollection, edges: RoadEdge[]): V2ReplayEvaluation {
  const scoredCells = scoreCells(cells);
  const roadRisk = scoreRoadRisk(scoredCells, edges);
  const brierScore = brier(scoredCells.features.map((cell) => [cell.properties.probability, target(cell.properties)]));
  const calibrationError = calibration(scoredCells.features.map((cell) => [cell.properties.probability, target(cell.properties)]));
  const roadMetrics = evaluateRoads(roadRisk);

  return {
    replayId: REPLAY_ID,
    mode: "replayed",
    asOf: AS_OF,
    validAt: VALID_AT,
    displayMode: "replayed",
    observationAgeDays: 0,
    confidence: round(mean(scoredCells.features.map((cell) => cell.properties.confidence))),
    modelVersions: ["wetting-v1", "persistence-v1"],
    manifestId: MANIFEST_ID,
    baselines: [
      {
        id: "current_flood_persistence",
        label: "Current flood persists",
        brierScore: brier(cells.features.map((cell) => [cell.properties.stateAtIssue === "wet" ? 0.82 : 0.18, target(cell.properties)]))
      },
      {
        id: "historical_frequency",
        label: "Historical frequency",
        brierScore: brier(cells.features.map((cell) => [cell.properties.historicalFloodFrequency, target(cell.properties)]))
      },
      {
        id: "rainfall_threshold",
        label: "Rainfall threshold",
        brierScore: brier(cells.features.map((cell) => [rainfallThreshold(cell.properties), target(cell.properties)]))
      }
    ],
    metrics: {
      brierScore,
      calibrationError,
      roadImpactRecall: roadMetrics.roadImpactRecall,
      falseSafeRoadRate: roadMetrics.falseSafeRoadRate,
      unnecessaryBlockRate: roadMetrics.unnecessaryBlockRate,
      routeAvailability: roadMetrics.routeAvailability
    },
    cells: scoredCells,
    roadRisk
  };
}

export function applyV2RiskToEdges(edges: RoadEdge[], evaluation: V2ReplayEvaluation): RoadEdge[] {
  const riskBySegment = new Map(evaluation.roadRisk.map((segment) => [segment.segmentId, segment]));

  return edges.map((edge) => {
    const risk = riskBySegment.get(edge.id);
    if (!risk) return edge;

    const forecastBlocked = risk.forecastRisk >= ROAD_BLOCK_THRESHOLD && risk.observedStatus === "observed_open_water_overlap";
    const nearFlood = edge.nearFlood || risk.forecastRisk >= 0.38;
    const riskPenalty = Math.round(edge.distanceMeters * risk.forecastRisk * 3);

    return {
      ...edge,
      blocked: edge.blocked || forecastBlocked,
      nearFlood,
      forecastRisk: risk.forecastRisk,
      forecastConfidence: risk.confidence,
      observedStatus: risk.observedStatus,
      cost: edge.cost + riskPenalty
    };
  });
}

function scoreCells(cells: V2ReplayCellCollection): V2ScoredCellCollection {
  return {
    type: "FeatureCollection",
    features: cells.features.map((cell) => {
      const probability = probabilityFor(cell.properties);
      const confidence = confidenceFor(cell.properties, probability);
      const spread = 0.14 + (1 - confidence) * 0.18;
      const properties: V2ScoredCellProperties = {
        ...cell.properties,
        model: cell.properties.stateAtIssue === "wet" ? "persistence-v1" : "wetting-v1",
        probability,
        lowerProbability: clamp(probability - spread),
        upperProbability: clamp(probability + spread),
        confidence,
        predictedWet: probability >= WET_THRESHOLD,
        observedWet: target(cell.properties) === 1,
        dominantFactor: dominantFactor(cell.properties)
      };

      return {
        ...cell,
        properties
      } as Feature<Polygon, V2ScoredCellProperties>;
    })
  };
}

function scoreRoadRisk(cells: V2ScoredCellCollection, edges: RoadEdge[]): V2RoadRiskSegment[] {
  return edges.map((edge) => {
    const line = turf.lineString(edge.geometry.coordinates);
    const touchedCells = cells.features.filter((cell) => turf.booleanIntersects(line, cell));
    const maxRisk = Math.max(0, ...touchedCells.map((cell) => cell.properties.probability));
    const confidence = touchedCells.length > 0 ? mean(touchedCells.map((cell) => cell.properties.confidence)) : 0.46;
    const issueObservedOverlap = touchedCells.some((cell) => cell.properties.stateAtIssue === "wet");
    const validObservedOverlap = touchedCells.some((cell) => cell.properties.observedWet);

    return {
      segmentId: edge.id,
      roadName: edge.name,
      observedStatus: issueObservedOverlap ? "observed_open_water_overlap" : "clear_observed",
      validationStatus: validObservedOverlap ? "observed_open_water_overlap" : "clear_observed",
      forecastRisk: round(maxRisk),
      confidence: round(confidence),
      fieldVerificationRequired: true
    };
  });
}

function evaluateRoads(segments: V2RoadRiskSegment[]) {
  const observedAffected = segments.filter((segment) => segment.validationStatus === "observed_open_water_overlap");
  const forecastAffected = segments.filter((segment) => segment.forecastRisk >= ROAD_BLOCK_THRESHOLD);
  const truePositive = forecastAffected.filter((segment) => segment.validationStatus === "observed_open_water_overlap").length;
  const falseSafe = observedAffected.filter((segment) => segment.forecastRisk < ROAD_BLOCK_THRESHOLD).length;
  const unnecessaryBlock = forecastAffected.filter((segment) => segment.validationStatus !== "observed_open_water_overlap").length;

  return {
    roadImpactRecall: round(observedAffected.length === 0 ? 1 : truePositive / observedAffected.length),
    falseSafeRoadRate: round(observedAffected.length === 0 ? 0 : falseSafe / observedAffected.length),
    unnecessaryBlockRate: round(segments.length === 0 ? 0 : unnecessaryBlock / segments.length),
    routeAvailability: forecastAffected.length >= segments.length ? 0 : 1
  };
}

function probabilityFor(properties: V2ReplayCellProperties) {
  if (properties.stateAtIssue === "wet") {
    return round(
      sigmoid(
        -0.95 +
          properties.forecast72hRainMm * 0.01 +
          properties.floodedNeighborFraction * 0.95 +
          properties.daysFloodedMin * 0.08 +
          properties.historicalResidenceMedianDays * 0.035 -
          properties.handMeters * 0.18 -
          properties.observationAgeDays * 0.04
      )
    );
  }

  return round(
    sigmoid(
      -2.8 +
        properties.forecast72hRainMm * 0.024 +
        properties.previous30dRainMm * 0.005 +
        properties.historicalFloodFrequency * 1.65 +
        properties.floodedNeighborFraction * 1.05 -
        properties.distanceToCurrentFloodM * 0.0011 -
        properties.handMeters * 0.22 -
        properties.observationAgeDays * 0.04
    )
  );
}

function confidenceFor(properties: V2ReplayCellProperties, probability: number) {
  const support = properties.historicalFloodFrequency > 0.35 ? 0.18 : -0.05;
  const agePenalty = properties.observationAgeDays * 0.04;
  const boundaryPenalty = probability > 0.42 && probability < 0.58 ? 0.14 : 0;
  return round(clamp(0.68 + support - agePenalty - boundaryPenalty));
}

function dominantFactor(properties: V2ReplayCellProperties) {
  if (properties.stateAtIssue === "wet") return "current_flood_connected";
  if (properties.forecast72hRainMm >= 65) return "rainfall_forecast";
  if (properties.historicalFloodFrequency >= 0.45) return "historical_frequency";
  if (properties.handMeters <= 1.1) return "low_hand";
  return "low_confidence";
}

function rainfallThreshold(properties: V2ReplayCellProperties) {
  if (properties.forecast72hRainMm >= 64 && properties.historicalFloodFrequency >= 0.35) return 0.72;
  if (properties.forecast72hRainMm >= 52 && properties.historicalFloodFrequency >= 0.25) return 0.48;
  return 0.18;
}

function target(properties: Pick<V2ReplayCellProperties, "observedAtValid">) {
  return properties.observedAtValid === "wet" ? 1 : 0;
}

function brier(pairs: number[][]) {
  return round(mean(pairs.map(([probability, actual]) => (probability - actual) ** 2)));
}

function calibration(pairs: number[][]) {
  const bins = [
    pairs.filter(([probability]) => probability < 0.33),
    pairs.filter(([probability]) => probability >= 0.33 && probability < 0.66),
    pairs.filter(([probability]) => probability >= 0.66)
  ].filter((bin) => bin.length > 0);

  return round(
    mean(
      bins.map((bin) => {
        const predicted = mean(bin.map(([probability]) => probability));
        const actual = mean(bin.map(([, observed]) => observed));
        return Math.abs(predicted - actual);
      })
    )
  );
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
