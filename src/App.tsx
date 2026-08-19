import { useEffect, useMemo, useState } from "react";
import { RescueMap } from "./components/RescueMap";
import { RoutePanel } from "./components/RoutePanel";
import { apiFetch } from "./lib/api";
import { loadDemoData } from "./lib/data";
import { analyzeEdges, calculateRoute } from "./lib/routing";
import { applySatelliteMaskToEdges } from "./lib/sentinelMasks";
import { applyV2RiskToEdges, evaluateV2Replay } from "./lib/v2Engine";
import { formatDate, formatDateRange } from "./lib/format";
import type {
  FloodCollection,
  IncidentLocation,
  IntelligenceResponse,
  LocalQuestionResponse,
  LocationsData,
  ObservationWindowKey,
  RoadCollection,
  SatelliteFloodChangeCollection,
  SatelliteFloodMaskCollection,
  SceneMetadata,
  SentinelFloodMaskManifest,
  SentinelQuicklookManifest,
  SentinelRoadMetricsReport,
  V2ReplayCellCollection
} from "./types";

type DemoData = {
  scene: SceneMetadata;
  roads: RoadCollection;
  floods: FloodCollection;
  locations: LocationsData;
  v2ReplayCells: V2ReplayCellCollection;
  sentinelQuicklooks: SentinelQuicklookManifest;
  satelliteFloodMask: SatelliteFloodMaskCollection;
  satelliteFloodChange: SatelliteFloodChangeCollection;
  floodMaskManifest: SentinelFloodMaskManifest;
  roadMetrics: SentinelRoadMetricsReport;
};

export default function App() {
  const [data, setData] = useState<DemoData | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState("marsh_report");
  const [activeWindow, setActiveWindow] = useState<ObservationWindowKey>("duringFlooding");
  const [showFlood, setShowFlood] = useState(true);
  const [satelliteLayerMode, setSatelliteLayerMode] = useState<"mask" | "change">("mask");
  const [intelligence, setIntelligence] = useState<IntelligenceResponse | null>(null);
  const [intelligenceStatus, setIntelligenceStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [evidencePenalties, setEvidencePenalties] = useState<Record<string, number>>({});
  const [localAnswer, setLocalAnswer] = useState<LocalQuestionResponse | null>(null);
  const [localAnswerStatus, setLocalAnswerStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    loadDemoData().then(setData).catch(() => setData(null));
  }, []);

  const selectedIncident = useMemo(() => {
    return data?.locations.incidents.find((incident) => incident.id === selectedIncidentId) ?? data?.locations.incidents[0];
  }, [data, selectedIncidentId]);

  const analyzed = useMemo(() => {
    if (!data || !selectedIncident) return null;
    const normalEdges = analyzeEdges(data.roads, data.floods, "normal");
    const floodEdges = analyzeEdges(data.roads, data.floods, "flood", evidencePenalties);
    const v2Evaluation = evaluateV2Replay(data.v2ReplayCells, normalEdges);
    const beforeEdges = applySatelliteMaskToEdges(normalEdges, data.satelliteFloodMask, "beforeFlooding", "context");
    const duringSatelliteEdges = applySatelliteMaskToEdges(floodEdges, data.satelliteFloodMask, "duringFlooding", "constraint");
    const recoveryEdges = applySatelliteMaskToEdges(normalEdges, data.satelliteFloodMask, "recoveryComparison", "context");
    const v2FloodEdges = applyV2RiskToEdges(duringSatelliteEdges, v2Evaluation);
    const normalRoute = calculateRoute(
      data.locations.nodes,
      normalEdges,
      data.locations.base.id,
      selectedIncident.nearestNodeId
    );
    const floodRoute = calculateRoute(
      data.locations.nodes,
      v2FloodEdges,
      data.locations.base.id,
      selectedIncident.nearestNodeId
    );
    const beforeRoute = calculateRoute(
      data.locations.nodes,
      beforeEdges,
      data.locations.base.id,
      selectedIncident.nearestNodeId
    );
    const recoveryRoute = calculateRoute(
      data.locations.nodes,
      recoveryEdges,
      data.locations.base.id,
      selectedIncident.nearestNodeId
    );
    return {
      normalEdges,
      beforeEdges,
      floodEdges: v2FloodEdges,
      recoveryEdges,
      normalRoute,
      beforeRoute,
      floodRoute,
      recoveryRoute,
      v2Evaluation
    };
  }, [data, selectedIncident, evidencePenalties]);

  const activeRouteView = useMemo(() => {
    if (!analyzed) return null;
    if (activeWindow === "duringFlooding") {
      return {
        edges: analyzed.floodEdges,
        currentRoute: analyzed.floodRoute,
        rejectedRoute: analyzed.normalRoute,
        showFlood: showFlood
      };
    }
    if (activeWindow === "recoveryComparison") {
      return {
        edges: analyzed.recoveryEdges,
        currentRoute: analyzed.recoveryRoute,
        rejectedRoute: null,
        showFlood: showFlood
      };
    }
    return {
      edges: analyzed.beforeEdges,
      currentRoute: analyzed.beforeRoute,
      rejectedRoute: null,
      showFlood: showFlood
    };
  }, [activeWindow, analyzed, showFlood]);

  async function runIntelligence() {
    if (!data || !selectedIncident || !analyzed) return;
    setIntelligenceStatus("loading");
    try {
      const response = await apiFetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scene: data.scene,
          observationWindows: data.scene.observationWindows,
          knownAssets: data.roads.features.map((feature) => feature.properties),
          destination: selectedIncident,
          route: analyzed.floodRoute
        })
      });
      if (!response.ok) throw new Error("Intelligence request failed");
      const payload = (await response.json()) as IntelligenceResponse;
      setIntelligence(payload);
      setIntelligenceStatus("ready");
    } catch {
      setIntelligence(publicDemoIntelligence(selectedIncident));
      setIntelligenceStatus("ready");
    }
  }

  function applyEvidence() {
    if (!intelligence) return;
    const nextPenalties: Record<string, number> = {};
    intelligence.evidence.forEach((item) => {
      if (
        item.matchedAssetId &&
        item.geographicSpecificity === "exact_asset" &&
        item.temporalMatch === "strong" &&
        item.confidence >= 0.8
      ) {
        nextPenalties[item.matchedAssetId] = 1800;
      }
    });
    setEvidencePenalties(nextPenalties);
  }

  function selectObservationWindow(windowKey: ObservationWindowKey) {
    setActiveWindow(windowKey);
    setShowFlood(true);
  }

  async function askLocalQuestion(question: string) {
    if (!data || !selectedIncident || !analyzed) return;
    setLocalAnswerStatus("loading");
    try {
      const response = await apiFetch("/api/local-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          scene: data.scene,
          observationWindows: data.scene.observationWindows,
          destination: selectedIncident,
          route: analyzed.floodRoute
        })
      });
      if (!response.ok) throw new Error("Local question request failed");
      const payload = (await response.json()) as LocalQuestionResponse;
      setLocalAnswer(payload);
      setLocalAnswerStatus("ready");
    } catch {
      setLocalAnswer(publicDemoLocalAnswer(question));
      setLocalAnswerStatus("ready");
    }
  }

  if (!data || !selectedIncident || !analyzed || !activeRouteView) {
    return <main className="loading">Loading #save_the_animals</main>;
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>#save_the_animals</h1>
          <p>Preliminary access route</p>
        </div>
        <div className="scene-meta">
          <span>{data.scene.sensor}</span>
          <span>{formatDate(data.scene.acquiredAt)}</span>
          <strong>Planning prototype</strong>
        </div>
      </header>

      <section className="window-strip" aria-label="Satellite comparison windows">
        <WindowBadge
          label={data.scene.observationWindows.beforeFlooding.label}
          value={formatDateRange(
            data.scene.observationWindows.beforeFlooding.start,
            data.scene.observationWindows.beforeFlooding.end
          )}
          windowKey="beforeFlooding"
          activeWindow={activeWindow}
          onSelect={selectObservationWindow}
        />
        <WindowBadge
          label={data.scene.observationWindows.duringFlooding.label}
          value={formatDateRange(
            data.scene.observationWindows.duringFlooding.start,
            data.scene.observationWindows.duringFlooding.end
          )}
          windowKey="duringFlooding"
          activeWindow={activeWindow}
          onSelect={selectObservationWindow}
        />
        <WindowBadge
          label={data.scene.observationWindows.recoveryComparison.label}
          value={formatDateRange(
            data.scene.observationWindows.recoveryComparison.start,
            data.scene.observationWindows.recoveryComparison.end
          )}
          windowKey="recoveryComparison"
          activeWindow={activeWindow}
          onSelect={selectObservationWindow}
        />
      </section>

      <section className="workspace">
        <div className="map-area">
          <div className="map-toolbar" aria-label="Map controls">
            <button
              className={activeRouteView.showFlood ? "toggle active" : "toggle"}
              onClick={() => setShowFlood((value) => !value)}
            >
              Flood overlay
            </button>
            <div className="segmented" aria-label="Satellite layer mode">
              <button
                className={satelliteLayerMode === "mask" ? "active" : ""}
                onClick={() => setSatelliteLayerMode("mask")}
                type="button"
              >
                Mask
              </button>
              <button
                className={satelliteLayerMode === "change" ? "active" : ""}
                onClick={() => setSatelliteLayerMode("change")}
                type="button"
              >
                Change
              </button>
            </div>
            <span className="map-note">{data.scene.note}</span>
          </div>
          <div className="map-legend" aria-label="Map legend">
            <span><i className="legend-route" /> current route</span>
            <span><i className="legend-rejected" /> rejected route</span>
            <span><i className="legend-flood" /> satellite flood</span>
            <span><i className="legend-risk" /> V2 risk</span>
            <span><i className="legend-change" /> change</span>
          </div>
          <RescueMap
            locations={data.locations}
            floods={data.floods}
            edges={activeRouteView.edges}
            currentRoute={activeRouteView.currentRoute}
            rejectedRoute={activeRouteView.rejectedRoute}
            selectedIncident={selectedIncident}
            showFlood={activeRouteView.showFlood}
            activeWindow={activeWindow}
            v2Replay={analyzed.v2Evaluation}
            satelliteFloodMask={data.satelliteFloodMask}
            satelliteFloodChange={data.satelliteFloodChange}
            satelliteLayerMode={satelliteLayerMode}
          />
        </div>

        <RoutePanel
          selectedIncident={selectedIncident}
          incidents={data.locations.incidents}
          route={activeRouteView.currentRoute}
          edges={activeRouteView.edges}
          evidence={intelligence}
          intelligenceStatus={intelligenceStatus}
          evidenceApplied={Object.keys(evidencePenalties).length > 0}
          onIncidentChange={(id) => {
            setSelectedIncidentId(id);
            setEvidencePenalties({});
            setIntelligence(null);
            setLocalAnswer(null);
            setIntelligenceStatus("idle");
            setLocalAnswerStatus("idle");
          }}
          onRunIntelligence={runIntelligence}
          onApplyEvidence={applyEvidence}
          localAnswer={localAnswer}
          localAnswerStatus={localAnswerStatus}
          onAskLocalQuestion={askLocalQuestion}
          v2Evaluation={analyzed.v2Evaluation}
          activeWindow={activeWindow}
          sentinelQuicklooks={data.sentinelQuicklooks}
          floodMaskManifest={data.floodMaskManifest}
          roadMetrics={data.roadMetrics}
        />
      </section>

      <footer>
        Preliminary planning aid. Satellite and web observations may be delayed or incomplete. Field verification is
        required.
      </footer>
    </main>
  );
}

function publicDemoIntelligence(selectedIncident: IncidentLocation): IntelligenceResponse {
  return {
    searchPlan: {
      window: {
        label: "During flooding",
        start: "2026-03-09",
        end: "2026-03-20"
      },
      queries: [
        {
          question: "Was any named Amboseli access road reported impassable near the observation date?",
          query: "Amboseli access road impassable flood March 2026",
          category: "road_access",
          dateStart: "2026-03-09",
          dateEnd: "2026-03-20",
          relevantAssetIds: ["central_to_eastern", "eastern_to_sinet"]
        },
        {
          question: "Were park infrastructure or causeways affected around the same period?",
          query: "Amboseli causeway flooding park infrastructure March 2026",
          category: "infrastructure",
          dateStart: "2026-03-09",
          dateEnd: "2026-03-20",
          relevantAssetIds: ["north_to_causeway"]
        },
        {
          question: "Do ranger or weather reports mention field access near Amboseli?",
          query: "Amboseli ranger weather report flooding March 2026",
          category: "field_report",
          dateStart: "2026-03-09",
          dateEnd: "2026-03-20",
          relevantAssetIds: []
        },
        {
          question: "Is there contradictory evidence that access remained open?",
          query: "Amboseli roads open March 2026 flood",
          category: "contradictory_evidence",
          dateStart: "2026-03-09",
          dateEnd: "2026-03-20",
          relevantAssetIds: ["bypass_to_eastern"]
        }
      ]
    },
    evidence: [
      {
        sourceTitle: "Public demo evidence cache",
        sourceUrl: "https://github.com/Stepodkelly/SaveTheAnimals",
        publicationDate: "2026-03-17",
        inferredEventDate: "2026-03-16",
        claim: "The public demo URL is running without server secrets. Local development uses live Exa and Gemini from the server-side .env file.",
        classification: "inconclusive",
        geographicSpecificity: "park_level",
        temporalMatch: "strong",
        confidence: 0.7
      }
    ],
    briefing: {
      summary: "Static public demo mode.",
      routeAssessment: `The preliminary access route to ${selectedIncident.name} remains deterministic. Live Exa/Gemini evidence is available in local server mode; the public static URL shows the same evidence workflow with a cached fallback.`,
      unknowns: ["Static GitHub Pages cannot hold private API keys."],
      recommendedVerification: ["Run the local server for live Exa/Gemini evidence retrieval."]
    },
    cached: true,
    sourceMode: "cached_fallback"
  };
}

function publicDemoLocalAnswer(question: string): LocalQuestionResponse {
  return {
    answer: `Public demo mode cannot call the secret-backed Exa service for "${question}". In local server mode, this box searches Exa for official public contacts and localized reports.`,
    sources: [
      {
        title: "Project repository",
        url: "https://github.com/Stepodkelly/SaveTheAnimals"
      }
    ],
    sourceMode: "cached_fallback",
    guardrail:
      "Private residents and unofficial personal contacts are excluded unless a source clearly publishes them as official public contact channels."
  };
}

function WindowBadge({
  label,
  value,
  windowKey,
  activeWindow,
  onSelect
}: {
  label: string;
  value: string;
  windowKey: ObservationWindowKey;
  activeWindow: ObservationWindowKey;
  onSelect: (windowKey: ObservationWindowKey) => void;
}) {
  const active = windowKey === activeWindow;
  return (
    <button
      type="button"
      className={active ? "window-badge active" : "window-badge"}
      aria-pressed={active}
      onClick={() => onSelect(windowKey)}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}
