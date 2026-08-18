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

export type ObservationWindow = {
  label: string;
  start: string;
  end: string;
};

export type ObservationWindowKey = "beforeFlooding" | "duringFlooding" | "recoveryComparison";

export type RoadCondition = "known_road" | "uncertain_track";

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

export type RouteResult = {
  status: "route_found" | "no_ground_route";
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
  sourceMode?: "live_exa" | "cached_fallback";
};

export type LocalQuestionResponse = {
  answer: string;
  sources: Array<{
    title: string;
    url: string;
    publishedDate?: string;
  }>;
  sourceMode: "live_exa" | "cached_fallback";
  guardrail: string;
};
