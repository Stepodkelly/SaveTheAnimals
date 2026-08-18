import { useEffect, useMemo, useState } from "react";
import { RescueMap } from "./components/RescueMap";
import { RoutePanel } from "./components/RoutePanel";
import { loadDemoData } from "./lib/data";
import { analyzeEdges, calculateRoute } from "./lib/routing";
import { formatDate, formatDateRange } from "./lib/format";
import type {
  FloodCollection,
  IncidentLocation,
  IntelligenceResponse,
  LocalQuestionResponse,
  LocationsData,
  ObservationWindowKey,
  RoadCollection,
  SceneMetadata
} from "./types";

type DemoData = {
  scene: SceneMetadata;
  roads: RoadCollection;
  floods: FloodCollection;
  locations: LocationsData;
};

export default function App() {
  const [data, setData] = useState<DemoData | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState("marsh_report");
  const [activeWindow, setActiveWindow] = useState<ObservationWindowKey>("duringFlooding");
  const [showFlood, setShowFlood] = useState(true);
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
    const normalRoute = calculateRoute(
      data.locations.nodes,
      normalEdges,
      data.locations.base.id,
      selectedIncident.nearestNodeId
    );
    const floodRoute = calculateRoute(
      data.locations.nodes,
      floodEdges,
      data.locations.base.id,
      selectedIncident.nearestNodeId
    );
    return { normalEdges, floodEdges, normalRoute, floodRoute };
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
        edges: analyzed.normalEdges,
        currentRoute: analyzed.normalRoute,
        rejectedRoute: null,
        showFlood: showFlood
      };
    }
    return {
      edges: analyzed.normalEdges,
      currentRoute: analyzed.normalRoute,
      rejectedRoute: null,
      showFlood: false
    };
  }, [activeWindow, analyzed, showFlood]);

  async function runIntelligence() {
    if (!data || !selectedIncident || !analyzed) return;
    setIntelligenceStatus("loading");
    try {
      const response = await fetch("/api/intelligence", {
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
      setIntelligenceStatus("error");
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
    setShowFlood(windowKey !== "beforeFlooding");
  }

  async function askLocalQuestion(question: string) {
    if (!data || !selectedIncident || !analyzed) return;
    setLocalAnswerStatus("loading");
    try {
      const response = await fetch("/api/local-question", {
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
      setLocalAnswerStatus("error");
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
              disabled={activeWindow === "beforeFlooding"}
            >
              Flood overlay
            </button>
            <span className="map-note">{data.scene.note}</span>
          </div>
          <div className="map-legend" aria-label="Map legend">
            <span><i className="legend-route" /> current route</span>
            <span><i className="legend-rejected" /> rejected route</span>
            <span><i className="legend-flood" /> satellite flood</span>
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
        />
      </section>

      <footer>
        Preliminary planning aid. Satellite and web observations may be delayed or incomplete. Field verification is
        required.
      </footer>
    </main>
  );
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
