import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

export type SceneMetadata = {
  sceneId: string;
  location: string;
  sensor: "Sentinel-1" | "Sentinel-2";
  acquiredAt?: string;
  acquisitionStart?: string;
  acquisitionEnd?: string;
  observationWindows: {
    beforeFlooding: ObservationWindow;
    duringFlooding: ObservationWindow;
    recoveryComparison: ObservationWindow;
  };
  bounds: [number, number, number, number];
  projection: string;
  width: number;
  height: number;
  note: string;
};

export type SentinelQuicklook = {
  sceneId: string;
  window: ObservationWindowKey;
  observedAt: string;
  platform: string;
  orbitState?: string;
  relativeOrbit?: number;
  polarizations: string[];
  href: string;
  sourceHref: string;
  productSize?: number;
  productUuid?: string;
};

export type SentinelQuicklookManifest = {
  scenes: SentinelQuicklook[];
};

export type SatelliteFloodMaskProperties = {
  cellId: string;
  window: ObservationWindowKey;
  observedAt: string;
  sceneId: string;
  sceneIds?: string[];
  sourceSceneCount?: number;
  floodProbability: number;
  confidence: number;
  classification: "possible_flood" | "probable_flood";
  vvMean: number;
  vhMean: number;
  method: string;
  georeference: string;
};

export type SatelliteFloodMaskCollection = FeatureCollection<Polygon, SatelliteFloodMaskProperties>;

export type SentinelFloodMaskManifest = {
  masks: Array<{
    window: ObservationWindowKey;
    href: string;
    status: "generated" | "missing";
    generatedAt?: string;
    sceneId?: string;
    sceneIds?: string[];
    observedAt?: string;
    observedRange?: {
      start?: string;
      end?: string;
    };
    sourceSceneCount?: number;
    featureCount: number;
    probableFloodAreaKm2: number;
    sourceAssetIds: string[];
    sourceUris?: string[];
    sourceSceneTypes?: Record<string, number>;
    quality?: {
      fullRasterFraction: number;
      rawSceneCount: number;
      quicklookSceneCount: number;
      confidenceTier: "strong" | "mixed" | "quicklook_only";
      caveat: string;
    };
    checksum?: string;
    method: {
      id: string;
      description: string;
      scoreThreshold?: number;
      aggregation?: string;
      sampleWidth?: number;
      sampleHeight?: number;
      cellsX?: number;
      cellsY?: number;
    };
    georeference: {
      source: string;
      note: string;
    };
  }>;
  changeLayer?: {
    href: string;
    status: "generated" | "missing";
    generatedAt?: string;
    checksum?: string;
    method: {
      id: string;
      description: string;
    };
    categories: Record<string, number>;
  };
};

export type SatelliteFloodMasksByWindow = Partial<Record<ObservationWindowKey, SatelliteFloodMaskCollection>>;

export type SatelliteFloodChangeProperties = {
  cellId: string;
  category: "newly_flooded" | "persistent_water" | "recovered_or_drying" | "residual_or_later_water" | "possible_change";
  beforeProbability: number;
  duringProbability: number;
  recoveryProbability: number;
  deltaDuringBefore: number;
  deltaRecoveryDuring: number;
  method: string;
};

export type SatelliteFloodChangeCollection = FeatureCollection<Polygon, SatelliteFloodChangeProperties>;

export type SentinelRoadMetricsReport = {
  generatedAt: string;
  method: string;
  caveat: string;
  windows: Array<{
    window: ObservationWindowKey;
    observedAt?: string;
    sceneId?: string;
    featureCount: number;
    probableFloodAreaKm2: number;
    directRoadTouches: Array<{
      roadId: string;
      roadName: string;
      probableCells: number;
      possibleCells: number;
      maxProbability: number;
    }>;
    nearRoadTouches: Array<{
      roadId: string;
      roadName: string;
      cellsWithin160m: number;
      maxProbability: number;
    }>;
    falseSafeRoadRate: number;
    unnecessaryBlockRate: number;
    routeAvailabilityProxy: number;
  }>;
  changeLayer: {
    href: string;
    featureCount: number;
    categories: Record<string, number>;
  } | null;
};

export type ObservationWindow = {
  label: string;
  start: string;
  end: string;
};

export type ObservationWindowKey = "beforeFlooding" | "duringFlooding" | "recoveryComparison";

export type RoadCondition = "known_road" | "uncertain_track";
export type RouteMode = "best_available" | "strict_clear";
export type RouteSafetyClass = "safe" | "caution" | "unsafe" | "no_route";

export type RoadNode = {
  id: string;
  name?: string;
  coordinates: [number, number];
};

export type RoadEdgeProperties = {
  id: string;
  from: string;
  to: string;
  name: string;
  condition: RoadCondition;
};

export type RoadEdgeFeature = Feature<LineString, RoadEdgeProperties>;

export type RoadEdge = RoadEdgeProperties & {
  geometry: LineString;
  distanceMeters: number;
  blocked: boolean;
  nearFlood: boolean;
  evidencePenalty: number;
  cost: number;
  forecastRisk?: number;
  forecastConfidence?: number;
  observedStatus?: "clear_observed" | "observed_open_water_overlap" | "unknown";
  directProbableFloodCells?: number;
  directPossibleFloodCells?: number;
  nearbyFloodCells?: number;
  maxFloodProbability?: number;
};

export type IncidentLocation = {
  id: string;
  name: string;
  coordinates: [number, number];
  nearestNodeId: string;
};

export type LocationsData = {
  base: RoadNode;
  incidents: IncidentLocation[];
  nodes: RoadNode[];
};

export type FloodCollection = FeatureCollection<Polygon>;
export type RoadCollection = FeatureCollection<LineString, RoadEdgeProperties>;

export type V2ReplayCellProperties = {
  cellId: string;
  label: string;
  stateAtIssue: "wet" | "dry" | "unknown";
  observedAtValid: "wet" | "dry" | "unknown";
  forecast72hRainMm: number;
  previous30dRainMm: number;
  historicalFloodFrequency: number;
  distanceToCurrentFloodM: number;
  floodedNeighborFraction: number;
  handMeters: number;
  observationAgeDays: number;
  daysFloodedMin: number;
  historicalResidenceMedianDays: number;
};

export type V2ScoredCellProperties = V2ReplayCellProperties & {
  model: "wetting-v1" | "persistence-v1";
  probability: number;
  lowerProbability: number;
  upperProbability: number;
  confidence: number;
  predictedWet: boolean;
  observedWet: boolean;
  dominantFactor: string;
};

export type V2ReplayCellCollection = FeatureCollection<Polygon, V2ReplayCellProperties>;
export type V2ScoredCellCollection = FeatureCollection<Polygon, V2ScoredCellProperties>;

export type V2RoadRiskSegment = {
  segmentId: string;
  roadName: string;
  observedStatus: "clear_observed" | "observed_open_water_overlap" | "unknown";
  validationStatus: "clear_observed" | "observed_open_water_overlap" | "unknown";
  forecastRisk: number;
  confidence: number;
  fieldVerificationRequired: boolean;
};

export type V2ReplayEvaluation = {
  replayId: string;
  mode: "replayed";
  asOf: string;
  validAt: string;
  displayMode: "replayed" | "simulated";
  observationAgeDays: number;
  confidence: number;
  modelVersions: string[];
  manifestId: string;
  baselines: Array<{
    id: string;
    label: string;
    brierScore: number;
  }>;
  metrics: {
    brierScore: number;
    calibrationError: number;
    roadImpactRecall: number;
    falseSafeRoadRate: number;
    unnecessaryBlockRate: number;
    routeAvailability: number;
  };
  cells: V2ScoredCellCollection;
  roadRisk: V2RoadRiskSegment[];
};

export type V2RealMaskEvaluation = {
  generatedAt: string;
  replayId: string;
  method: string;
  caveat: string;
  targetWindow: {
    window: ObservationWindowKey;
    observedRange: {
      start?: string;
      end?: string;
    } | null;
    maskMethod: string;
    maskWetThreshold: number;
  };
  comparisonWindows: {
    beforeFlooding: {
      start?: string;
      end?: string;
    } | null;
    recoveryComparison: {
      start?: string;
      end?: string;
    } | null;
  };
  metrics: {
    evaluatedCells: number;
    brierScore: number;
    calibrationError: number;
    precision: number;
    recall: number;
    fixtureAgreement: number;
  };
  trainedRegression: {
    protocol: string;
    status: "evaluated" | "insufficient_examples";
    featureNames: string[];
    metrics: {
      evaluatedCells: number;
      brierScore: number | null;
      calibrationError: number | null;
      precision: number | null;
      recall: number | null;
    };
    predictions?: Array<{
      cellId: string;
      label: string;
      trainedProbability: number;
      observedWet: boolean;
    }>;
  };
  thresholdTuning: {
    heuristic: V2ThresholdSweep;
    trained: V2ThresholdSweep;
  };
  baselines: Array<{
    id: string;
    label: string;
    brierScore: number;
  }>;
  confusion: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    trueNegative: number;
  };
};

export type V2ThresholdSweep = {
  status: "evaluated" | "no_examples";
  selectedThreshold: number | null;
  selectedMetric: string;
  selected?: {
    threshold: number;
    precision: number;
    recall: number;
    f1: number;
    falseSafeRate: number;
    unnecessaryBlockRate: number;
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    trueNegative: number;
  };
};

export type RouteResult = {
  status: "route_found" | "no_ground_route";
  safetyClass: RouteSafetyClass;
  routingMode: RouteMode;
  edgeIds: string[];
  distanceMeters: number;
  riskLevel: "low" | "moderate" | "high" | "unknown";
  reasons: string[];
  geometry: LineString | null;
  instructions: string[];
};

export type EvidenceItem = {
  sourceTitle: string;
  sourceUrl: string;
  publicationDate?: string;
  inferredEventDate?: string;
  claim: string;
  classification: "corroborates" | "contradicts" | "inconclusive";
  geographicSpecificity: "exact_asset" | "park_level" | "regional" | "unknown";
  temporalMatch: "strong" | "weak" | "mismatch" | "unknown";
  matchedAssetId?: string;
  confidence: number;
};

export type IntelligenceResponse = {
  searchPlan: {
    window?: ObservationWindow;
    queries: Array<{
      question: string;
      query: string;
      category:
        | "road_access"
        | "weather"
        | "infrastructure"
        | "field_report"
        | "contradictory_evidence";
      dateStart: string;
      dateEnd: string;
      relevantAssetIds: string[];
    }>;
  };
  evidence: EvidenceItem[];
  briefing: {
    summary: string;
    routeAssessment: string;
    unknowns: string[];
    recommendedVerification: string[];
  };
  cached?: boolean;
  sourceMode?: "live_exa" | "live_exa_openai" | "live_exa_gemini" | "cached_fallback";
};

export type LocalQuestionResponse = {
  answer: string;
  sources: Array<{
    title: string;
    url: string;
    publishedDate?: string;
  }>;
  sourceMode: "live_exa" | "live_exa_openai" | "live_exa_gemini" | "cached_fallback";
  guardrail: string;
};
