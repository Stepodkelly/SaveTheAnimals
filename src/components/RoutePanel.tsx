import { FormEvent, useState } from "react";
import type {
  EvidenceItem,
  IncidentLocation,
  IntelligenceResponse,
  LocalQuestionResponse,
  ObservationWindowKey,
  RoadEdge,
  RouteResult,
  SentinelFloodMaskManifest,
  SentinelQuicklookManifest,
  V2ReplayEvaluation
} from "../types";
import { formatDate, formatMeters } from "../lib/format";

type RoutePanelProps = {
  selectedIncident: IncidentLocation;
  incidents: IncidentLocation[];
  route: RouteResult;
  edges: RoadEdge[];
  evidence: IntelligenceResponse | null;
  intelligenceStatus: "idle" | "loading" | "ready" | "error";
  evidenceApplied: boolean;
  localAnswer: LocalQuestionResponse | null;
  localAnswerStatus: "idle" | "loading" | "ready" | "error";
  onIncidentChange: (incidentId: string) => void;
  onRunIntelligence: () => void;
  onApplyEvidence: () => void;
  onAskLocalQuestion: (question: string) => void;
  v2Evaluation: V2ReplayEvaluation;
  activeWindow: ObservationWindowKey;
  sentinelQuicklooks: SentinelQuicklookManifest;
  floodMaskManifest: SentinelFloodMaskManifest;
};

export function RoutePanel({
  selectedIncident,
  incidents,
  route,
  edges,
  evidence,
  intelligenceStatus,
  evidenceApplied,
  localAnswer,
  localAnswerStatus,
  onIncidentChange,
  onRunIntelligence,
  onApplyEvidence,
  onAskLocalQuestion,
  v2Evaluation,
  activeWindow,
  sentinelQuicklooks,
  floodMaskManifest
}: RoutePanelProps) {
  const [question, setQuestion] = useState("Which public office or ranger contact should verify road access?");
  const blockedEdges = edges.filter((edge) => edge.blocked);
  const exactEvidence = evidence?.evidence.filter(isApplicableEvidence) ?? [];
  const planRows = evidence?.searchPlan.queries ?? defaultPlanRows;
  const activeScenes = sentinelQuicklooks.scenes.filter((scene) => scene.window === activeWindow);
  const previewScenes = activeScenes.slice(-2);
  const activeFloodMask = floodMaskManifest.masks.find((mask) => mask.window === activeWindow);

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed) onAskLocalQuestion(trimmed);
  }

  return (
    <aside className="side-panel">
      <section className="panel-section">
        <label className="field-label" htmlFor="incident">
          Incident
        </label>
        <select
          id="incident"
          className="select"
          value={selectedIncident.id}
          onChange={(event) => onIncidentChange(event.target.value)}
        >
          {incidents.map((incident) => (
            <option key={incident.id} value={incident.id}>
              {incident.name}
            </option>
          ))}
        </select>
      </section>

      <section className="metric-grid" aria-label="Route metrics">
        <Metric label="Status" value={route.status === "route_found" ? "route found" : "no ground route"} />
        <Metric label="Distance" value={formatMeters(route.distanceMeters)} />
        <Metric label="Risk" value={route.riskLevel} />
        <Metric label="Blocked" value={String(blockedEdges.length)} />
      </section>

      <section className="panel-section">
        <div className="panel-heading-row">
          <div>
            <h2>V2 Replay Gate</h2>
            <p className="eyebrow">Simple regression, judged by replay.</p>
          </div>
          <span className="chip">{v2Evaluation.displayMode}</span>
        </div>
        <div className="replay-grid" aria-label="V2 replay regression status">
          <div>
            <span>issue</span>
            <strong>{formatDate(v2Evaluation.asOf)}</strong>
          </div>
          <div>
            <span>valid</span>
            <strong>{formatDate(v2Evaluation.validAt)}</strong>
          </div>
          <div>
            <span>Wetting</span>
            <strong>dry to wet</strong>
          </div>
          <div>
            <span>Persistence</span>
            <strong>wet stays wet</strong>
          </div>
        </div>
        <div className="metric-pills" aria-label="V2 replay metrics">
          <span>
            Brier: <strong>{v2Evaluation.metrics.brierScore.toFixed(3)}</strong>
          </span>
          <span>
            False-safe roads: <strong>{asPercent(v2Evaluation.metrics.falseSafeRoadRate)}</strong>
          </span>
          <span>
            Road recall: <strong>{asPercent(v2Evaluation.metrics.roadImpactRecall)}</strong>
          </span>
          <span>
            Calibration: <strong>{v2Evaluation.metrics.calibrationError.toFixed(3)}</strong>
          </span>
        </div>
        <div className="baseline-list" aria-label="V2 replay baselines">
          {v2Evaluation.baselines.map((baseline) => (
            <span key={baseline.id}>
              {baseline.label}: <strong>{baseline.brierScore.toFixed(3)}</strong>
            </span>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-heading-row">
          <div>
            <h2>Sentinel Sources</h2>
            <p className="eyebrow">{activeScenes.length} catalogued scenes in this window.</p>
          </div>
          <span className="chip">CDSE STAC</span>
        </div>
        <div className="quicklook-grid" aria-label="Sentinel-1 source quicklooks">
          {previewScenes.map((scene) => (
            <figure key={scene.sceneId}>
              <img src={`${import.meta.env.BASE_URL}${scene.href}`} alt={`Sentinel-1 quicklook ${scene.sceneId}`} />
              <figcaption>
                <strong>{scene.platform.replace("sentinel-", "S")}</strong>
                <span>{formatDate(scene.observedAt)}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        {activeFloodMask && (
          <div className="mask-summary" aria-label="Sentinel-1 flood mask summary">
            <span>Satellite-derived layer</span>
            <strong>{activeFloodMask.probableFloodAreaKm2.toFixed(2)} km2 probable</strong>
            <small>{activeFloodMask.method.id}; provisional overlay</small>
          </div>
        )}
      </section>

      <section className="panel-section">
        <h2>Route Instructions</h2>
        <div className="route-line" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <ol className="instruction-list">
          {route.instructions.map((instruction) => (
            <li key={instruction}>{instruction}</li>
          ))}
        </ol>
      </section>

      <section className="panel-section">
        <h2>Affected Roads</h2>
        <div className="edge-bars">
          {edges.map((edge) => (
            <div className="edge-row" key={edge.id}>
              <span>{edge.name}</span>
              <div
                className="edge-track"
                title={
                  edge.blocked
                    ? "Blocked by issue-time observed flooding"
                    : `Forecast risk ${edge.forecastRisk === undefined ? "unknown" : asPercent(edge.forecastRisk)}`
                }
              >
                <div
                  className={edge.blocked ? "edge-fill blocked" : edge.nearFlood ? "edge-fill caution" : "edge-fill"}
                  style={{ width: `${Math.max(18, Math.min(100, edge.cost / 90))}%` }}
                />
              </div>
              <strong>{edge.forecastRisk === undefined ? "--" : asPercent(edge.forecastRisk)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-heading-row">
          <div>
            <h2>Exa-Powered Route Explanation</h2>
            <p className="eyebrow">Gemini plans the checks; Exa retrieves reports.</p>
          </div>
          <button className="text-button" onClick={onRunIntelligence} disabled={intelligenceStatus === "loading"}>
            {intelligenceStatus === "loading" ? "Checking" : "Run"}
          </button>
        </div>

        <div className="plan-list" aria-label="Exa Gemini route explanation plan">
          {planRows.map((query) => (
            <div className="plan-row" key={`${query.category}-${query.question}`}>
              <strong>{query.category.replace(/_/g, " ")}</strong>
              <span>{query.question}</span>
            </div>
          ))}
        </div>

        {intelligenceStatus === "idle" && <p className="muted">Run the live Exa check after reviewing the route.</p>}
        {intelligenceStatus === "error" && (
          <p className="muted">Evidence service unavailable. Satellite routing remains available.</p>
        )}
        {evidence && (
          <>
            <p className={evidence.cached ? "chip" : "chip live"}>{evidence.cached ? "cached fallback" : "live Exa"}</p>
            <p className="briefing">{evidence.briefing.routeAssessment}</p>
            <div className="evidence-list">
              {evidence.evidence.map((item) => (
                <EvidenceCard key={`${item.sourceTitle}-${item.claim}`} item={item} />
              ))}
            </div>
            <button
              className="primary-button"
              onClick={onApplyEvidence}
              disabled={exactEvidence.length === 0 || evidenceApplied}
            >
              {evidenceApplied ? "Evidence flagged" : "Flag exact-asset evidence"}
            </button>
          </>
        )}
      </section>

      <section className="panel-section">
        <div>
          <h2>Local Q&amp;A</h2>
          <p className="eyebrow">Public contacts and localized reports only.</p>
        </div>
        <form className="ask-form" onSubmit={submitQuestion}>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={240}
            aria-label="Ask a local information question"
          />
          <button className="primary-button" type="submit" disabled={localAnswerStatus === "loading"}>
            {localAnswerStatus === "loading" ? "Searching" : "Ask"}
          </button>
        </form>

        {localAnswerStatus === "error" && <p className="muted">Local answer unavailable.</p>}
        {localAnswer && (
          <article className="answer-card">
            <p className={localAnswer.sourceMode === "live_exa" ? "chip live" : "chip"}>
              {localAnswer.sourceMode === "live_exa" ? "live Exa" : "cached fallback"}
            </p>
            <p>{localAnswer.answer}</p>
            <small>{localAnswer.guardrail}</small>
            <div className="source-list">
              {localAnswer.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              ))}
            </div>
          </article>
        )}
      </section>
    </aside>
  );
}

const defaultPlanRows = [
  {
    question: "Check whether any named access road was reported impassable near the observation date.",
    category: "road_access"
  },
  {
    question: "Check whether park infrastructure or causeways were affected during the same window.",
    category: "infrastructure"
  },
  {
    question: "Check ranger, field or weather reports for route-level access warnings.",
    category: "field_report"
  },
  {
    question: "Check for contradictory reports that mapped roads remained open.",
    category: "contradictory_evidence"
  }
];

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EvidenceCard({ item }: { item: EvidenceItem }) {
  return (
    <article className="evidence-card">
      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
        {item.sourceTitle}
      </a>
      <p>{item.claim}</p>
      <dl>
        <div>
          <dt>specificity</dt>
          <dd>{item.geographicSpecificity}</dd>
        </div>
        <div>
          <dt>time</dt>
          <dd>{item.temporalMatch}</dd>
        </div>
        <div>
          <dt>confidence</dt>
          <dd>{Math.round(item.confidence * 100)}%</dd>
        </div>
      </dl>
    </article>
  );
}

function isApplicableEvidence(item: EvidenceItem) {
  return (
    item.geographicSpecificity === "exact_asset" &&
    item.temporalMatch === "strong" &&
    item.confidence >= 0.8 &&
    Boolean(item.matchedAssetId)
  );
}

function asPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
