import { FormEvent, useState } from "react";
import type {
  EvidenceItem,
  GroundTruthValidationReport,
  IncidentLocation,
  IntelligenceResponse,
  LocalQuestionResponse,
  ObservationWindowKey,
  RoadEdge,
  RouteResult,
  RouteMode,
  SentinelFloodMaskManifest,
  SentinelQuicklookManifest,
  SentinelRoadMetricsReport,
  V2RealMaskEvaluation,
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
  routeMode: RouteMode;
  onRouteModeChange: (mode: RouteMode) => void;
  v2Evaluation: V2ReplayEvaluation;
  activeWindow: ObservationWindowKey;
  sentinelQuicklooks: SentinelQuicklookManifest;
  floodMaskManifest: SentinelFloodMaskManifest;
  roadMetrics: SentinelRoadMetricsReport;
  realMaskEvaluation: V2RealMaskEvaluation | null;
  groundTruthValidation: GroundTruthValidationReport;
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
  routeMode,
  onRouteModeChange,
  v2Evaluation,
  activeWindow,
  sentinelQuicklooks,
  floodMaskManifest,
  roadMetrics,
  realMaskEvaluation,
  groundTruthValidation
}: RoutePanelProps) {
  const [question, setQuestion] = useState("Which public office or ranger contact should verify road access?");
  const blockedEdges = edges.filter((edge) => edge.blocked);
  const routeEdges = route.edgeIds.map((edgeId) => edges.find((edge) => edge.id === edgeId)).filter(Boolean) as RoadEdge[];
  const routeAudit = auditRoute(routeEdges, route);
  const exactEvidence = evidence?.evidence.filter(isApplicableEvidence) ?? [];
  const planRows = evidence?.searchPlan.queries ?? defaultPlanRows;
  const activeScenes = sentinelQuicklooks.scenes.filter((scene) => scene.window === activeWindow);
  const previewScenes = activeScenes.slice(-2);
  const activeFloodMask = floodMaskManifest.masks.find((mask) => mask.window === activeWindow);
  const activeRoadMetrics = roadMetrics.windows.find((windowMetrics) => windowMetrics.window === activeWindow);
  const changeCategories = floodMaskManifest.changeLayer?.categories ?? roadMetrics.changeLayer?.categories;
  const maskGridCells = realMaskEvaluation?.sampleSummary?.maskGridDiagnosticCells ?? 0;
  const verifiedRoads = groundTruthValidation.summary.verifiedRoadCount;

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

      <section className="panel-section">
        <label className="field-label" id="route-mode-label">
          Route Mode
        </label>
        <div className="segmented wide" aria-labelledby="route-mode-label">
          <button
            className={routeMode === "best_available" ? "active" : ""}
            onClick={() => onRouteModeChange("best_available")}
            type="button"
          >
            Best
          </button>
          <button
            className={routeMode === "strict_clear" ? "active" : ""}
            onClick={() => onRouteModeChange("strict_clear")}
            type="button"
          >
            Strict
          </button>
        </div>
      </section>

      <section className="metric-grid" aria-label="Route metrics">
        <Metric label="Status" value={route.status === "route_found" ? "route found" : "no ground route"} />
        <Metric label="Distance" value={formatMeters(route.distanceMeters)} />
        <Metric label="Safety" value={route.safetyClass.replace("_", " ")} />
        <Metric label="Blocked" value={String(blockedEdges.length)} />
      </section>

      <section className="panel-section">
        <div className="mask-summary" aria-label="Current route flood audit">
          <span>Route flood check</span>
          <strong>{routeAudit.summary}</strong>
          <small>{routeAudit.detail}</small>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-heading-row">
          <div>
            <h2>Model Replay Gate</h2>
            <p className="eyebrow">V2 model prediction, judged by replay.</p>
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
        {realMaskEvaluation && (
          <div className="mask-evaluation" aria-label="Model-vs-mask evaluation">
            <span>Model-vs-mask evaluation</span>
            <strong>
              Heuristic {realMaskEvaluation.metrics.brierScore.toFixed(3)} · trained{" "}
              {formatNullableMetric(realMaskEvaluation.trainedRegression.metrics.brierScore)}
            </strong>
            <small>Source: V2 model prediction, tested against generated Sentinel mask labels.</small>
            <small>
              Sample: {realMaskEvaluation.metrics.evaluatedCells} mask-labeled cells;{" "}
              {realMaskEvaluation.targetWindow.maskMethod}
            </small>
            {realMaskEvaluation.sampleSummary && (
              <small>
                {realMaskEvaluation.sampleSummary.replayCellsWithMaskCoverage} replay cells + {maskGridCells} mask-grid
                diagnostics
              </small>
            )}
            {realMaskEvaluation.maskGridRegression?.metrics.brierScore !== undefined && (
              <small>
                grid regression {formatNullableMetric(realMaskEvaluation.maskGridRegression.metrics.brierScore)}
              </small>
            )}
            <small>
              tuned threshold {formatNullableMetric(realMaskEvaluation.thresholdTuning.trained.selectedThreshold)}
            </small>
            <small>Not independent field truth.</small>
          </div>
        )}
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
            <span>Satellite observed flood likelihood</span>
            <strong>{activeFloodMask.probableFloodAreaKm2.toFixed(2)} km2 probable satellite flood</strong>
            <small>
              Source: Sentinel-1 observed likelihood; {activeFloodMask.sourceSceneCount ?? 1} scenes.
            </small>
            {activeFloodMask.quality && (
              <small>
                {activeFloodMask.quality.rawSceneCount} raw / {activeFloodMask.quality.quicklookSceneCount} quicklook;{" "}
                {activeFloodMask.quality.confidenceTier}; {activeFloodMask.method.id}
              </small>
            )}
            <small>Possible = lower satellite likelihood; probable = higher satellite likelihood.</small>
          </div>
        )}
        {activeRoadMetrics && (
          <div className="metric-pills" aria-label="Sentinel-1 road metrics">
            <span>
              Direct roads: <strong>{activeRoadMetrics.directRoadTouches.length}</strong>
            </span>
            <span>
              Near roads: <strong>{activeRoadMetrics.nearRoadTouches.length}</strong>
            </span>
            <span>
              Route available: <strong>{asPercent(activeRoadMetrics.routeAvailabilityProxy)}</strong>
            </span>
          </div>
        )}
        {changeCategories && (
          <div className="baseline-list" aria-label="Sentinel-1 change categories">
            {Object.entries(changeCategories).map(([category, count]) => (
              <span key={category}>
                {changeCategoryLabel(category)}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="confidence-note" aria-label="Data confidence and prototype limits">
          <span>Data confidence</span>
          <strong>{confidenceHeadline(activeFloodMask, groundTruthValidation)}</strong>
          <small>
            Satellite masks are observed-likelihood planning overlays. Model diagnostics use generated Sentinel mask
            cells, not independent inundation labels.
          </small>
          <small>
            Field validation: {verifiedRoads}/{groundTruthValidation.summary.roads || edges.length} roads verified;{" "}
            {groundTruthValidation.summary.candidateSources} public candidate sources need review.
          </small>
        </div>
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
                    ? "Blocked by route decision logic"
                    : `Model predicted risk ${edge.forecastRisk === undefined ? "unknown" : asPercent(edge.forecastRisk)}`
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
            <p className="eyebrow">AI plans the checks; Exa retrieves reports.</p>
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
            <p className={evidence.cached ? "chip" : "chip live"}>{sourceModeLabel(evidence.sourceMode)}</p>
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
            <p className={isLiveSourceMode(localAnswer.sourceMode) ? "chip live" : "chip"}>
              {sourceModeLabel(localAnswer.sourceMode)}
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

function formatNullableMetric(value: number | null) {
  return value === null ? "--" : value.toFixed(3);
}

function confidenceHeadline(
  activeFloodMask: SentinelFloodMaskManifest["masks"][number] | undefined,
  groundTruthValidation: GroundTruthValidationReport
) {
  const rawScenes = activeFloodMask?.quality?.rawSceneCount ?? 0;
  const quicklooks = activeFloodMask?.quality?.quicklookSceneCount ?? 0;
  const validation =
    groundTruthValidation.validationStatus === "partially_ground_truthed"
      ? "field-reviewed"
      : groundTruthValidation.validationStatus === "candidate_sources_found"
        ? "candidate sources"
        : "field truth pending";
  return `${rawScenes} raw / ${quicklooks} preview scenes; ${validation}`;
}

function changeCategoryLabel(category: string) {
  if (category === "newly_flooded") return "Observed newly flooded cells";
  if (category === "persistent_water") return "Observed persistent water cells";
  if (category === "recovered_or_drying") return "Observed recovered/drying cells";
  if (category === "residual_or_later_water") return "Observed residual/later water cells";
  return "Observed possible-change cells";
}

function auditRoute(routeEdges: RoadEdge[], route: RouteResult) {
  if (route.status !== "route_found") {
    return {
      summary: "No strict-clear path",
      detail:
        route.routingMode === "strict_clear"
          ? "Strict mode rejects blocked roads and direct possible/probable satellite-flood cells."
          : "The selected destination is cut off by blocked road edges in this scenario."
    };
  }

  const directProbable = sum(routeEdges.map((edge) => edge.directProbableFloodCells ?? 0));
  const directPossible = sum(routeEdges.map((edge) => edge.directPossibleFloodCells ?? 0));
  const nearby = sum(routeEdges.map((edge) => edge.nearbyFloodCells ?? 0));
  const maxSatelliteLikelihood = Math.max(0, ...routeEdges.map((edge) => edge.maxFloodProbability ?? 0));
  const maxModelRisk = Math.max(0, ...routeEdges.map((edge) => edge.forecastRisk ?? 0));
  const hasExternalEvidence = routeEdges.some((edge) => edge.evidencePenalty > 0);
  const sourceTags = routeSourceTags({ directProbable, directPossible, nearby, maxModelRisk, hasExternalEvidence });
  const sourceText = sourceTags.length > 0 ? ` Source: ${sourceTags.join("; ")}.` : "";

  if (directProbable > 0) {
    return {
      summary: "Unsafe: probable satellite overlap",
      detail: `${directProbable} probable satellite-flood overlaps; max satellite likelihood ${asPercent(
        maxSatelliteLikelihood
      )}.${sourceText} Field verification required.`
    };
  }
  if (directPossible > 0) {
    return {
      summary: "Unsafe: possible satellite overlap",
      detail: `${directPossible} possible satellite-flood overlaps; max satellite likelihood ${asPercent(
        maxSatelliteLikelihood
      )}.${sourceText} Field verification required.`
    };
  }
  if (nearby > 0) {
    return {
      summary: "Caution: satellite cells nearby",
      detail: `${nearby} nearby satellite-flood cells within the route buffer; max satellite likelihood ${asPercent(
        maxSatelliteLikelihood
      )}.${sourceText} Field verification required.`
    };
  }
  if (maxModelRisk > 0.38) {
    return {
      summary: "Caution: model forecast penalty",
      detail: `No direct satellite-mask overlap; max model predicted risk ${asPercent(
        maxModelRisk
      )}.${sourceText} Field verification required.`
    };
  }
  if (hasExternalEvidence) {
    return {
      summary: "Caution: external evidence",
      detail: `No direct satellite-mask overlap; external evidence increased route cost.${sourceText} Field verification required.`
    };
  }
  return {
    summary: "Safe: avoids observed cells",
    detail: "No direct or nearby Sentinel observed-likelihood cells on the selected route."
  };
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function routeSourceTags({
  directProbable,
  directPossible,
  nearby,
  maxModelRisk,
  hasExternalEvidence
}: {
  directProbable: number;
  directPossible: number;
  nearby: number;
  maxModelRisk: number;
  hasExternalEvidence: boolean;
}) {
  const tags: string[] = [];
  if (directProbable > 0 || directPossible > 0) tags.push("direct satellite-mask overlap");
  if (nearby > 0) tags.push("nearby satellite-mask cells");
  if (maxModelRisk > 0.38) tags.push("model forecast penalty");
  if (hasExternalEvidence) tags.push("external evidence");
  return tags;
}

function sourceModeLabel(sourceMode?: string) {
  if (sourceMode === "live_exa_openai") return "live Exa + OpenAI";
  if (sourceMode === "live_exa_gemini") return "live Exa + Gemini";
  if (sourceMode === "live_exa") return "live Exa";
  return "cached fallback";
}

function isLiveSourceMode(sourceMode?: string) {
  return sourceMode === "live_exa" || sourceMode === "live_exa_openai" || sourceMode === "live_exa_gemini";
}
