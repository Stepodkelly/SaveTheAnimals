import fs from "node:fs";
import path from "node:path";
import * as turf from "@turf/turf";
import { loadProjectEnv } from "./env.mjs";

const rootDir = process.cwd();
loadProjectEnv(rootDir);

const reviewsDir = path.join(rootDir, "versions/v2-forecast-mvp/data/reviews");
const roadsPath = path.join(rootDir, "public/data/amboseli/roads.geojson");
const scenePath = path.join(rootDir, "public/data/amboseli/scene.json");
const roadMetricsPath = path.join(rootDir, "public/data/amboseli/sentinel1-road-metrics.json");
const publicReportPath = path.join(rootDir, "public/data/amboseli/ground-truth-validation.json");
const assetReportPath = path.join(rootDir, "versions/v2-forecast-mvp/data/reports/ground_truth_validation.json");
const runLiveExa = process.env.RUN_LIVE_EXA === "true";

for (const requiredPath of [roadsPath, scenePath, roadMetricsPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Missing ${path.relative(rootDir, requiredPath)}.`);
}

const roads = JSON.parse(fs.readFileSync(roadsPath, "utf8"));
const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
const roadMetrics = JSON.parse(fs.readFileSync(roadMetricsPath, "utf8"));
const eventOverrides = readCsv(path.join(reviewsDir, "event_overrides.csv"));
const observationOverrides = readCsv(path.join(reviewsDir, "observation_overrides.csv"));
const spatialOverrides = readGeoJson(path.join(reviewsDir, "spatial_overrides.geojson"));
const candidateSources = runLiveExa ? await findCandidateSources() : [];

const reviewedEvents = eventOverrides.filter((row) => hasMeaningfulReview(row));
const reviewedObservations = observationOverrides.filter((row) => hasMeaningfulReview(row));
const reviewedSpatialFeatures = (spatialOverrides.features ?? []).filter((feature) =>
  hasMeaningfulReview(feature.properties ?? {})
);
const roadStatuses = roads.features.map((road) => roadValidation(road, reviewedObservations, reviewedSpatialFeatures));
const verifiedRoadCount = roadStatuses.filter((road) => road.validationStatus !== "unverified").length;
const candidateExactRoadSources = candidateSources.filter((source) => source.matchedRoadIds.length > 0).length;
const validationStatus =
  verifiedRoadCount > 0
    ? "partially_ground_truthed"
    : candidateSources.length > 0
      ? "candidate_sources_found"
      : "no_ground_truth_yet";

const report = {
  generatedAt: new Date().toISOString(),
  method: "route-ground-truth-validation-v1",
  validationStatus,
  caveat:
    "Satellite masks and Exa/web candidates are not treated as field truth. A road becomes ground-truthed only when a reviewer records an official road, ranger, police, park, county, NGO, or field observation in the review override files.",
  observationWindow: scene.observationWindows.duringFlooding,
  reviewInputs: {
    eventOverrideRows: eventOverrides.length,
    reviewedEventRows: reviewedEvents.length,
    observationOverrideRows: observationOverrides.length,
    reviewedObservationRows: reviewedObservations.length,
    spatialOverrideFeatures: spatialOverrides.features?.length ?? 0,
    reviewedSpatialFeatures: reviewedSpatialFeatures.length
  },
  sourceSearch: {
    mode: runLiveExa ? "live_exa" : "not_run",
    candidateSources: candidateSources.length,
    candidateExactRoadSources,
    note:
      candidateSources.length > 0
        ? "Candidate sources require human review before they affect routing."
        : "Run with RUN_LIVE_EXA=true and EXA_API_KEY set to collect candidate public sources."
  },
  roadStatuses,
  summary: {
    roads: roadStatuses.length,
    verifiedRoadCount,
    unverifiedRoadCount: roadStatuses.length - verifiedRoadCount,
    candidateSources: candidateSources.length,
    candidateExactRoadSources
  },
  requiredNextEvidence: [
    "Official or field-confirmed road-open/road-closed observations for named route segments.",
    "Timestamped ranger, park, county, police, aid-organization, or conservancy reports for March 9-20, 2026.",
    "Reviewer-entered spatial observations when a report is point- or polygon-specific."
  ],
  candidateSources
};

fs.mkdirSync(path.dirname(publicReportPath), { recursive: true });
fs.mkdirSync(path.dirname(assetReportPath), { recursive: true });
fs.writeFileSync(publicReportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(assetReportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${path.relative(rootDir, publicReportPath)}`);
console.log(`Wrote ${path.relative(rootDir, assetReportPath)}`);
console.log(
  `Ground truth status: ${validationStatus}; verified roads ${verifiedRoadCount}/${roadStatuses.length}; candidate sources ${candidateSources.length}`
);

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 1) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function readGeoJson(filePath) {
  if (!fs.existsSync(filePath)) return { type: "FeatureCollection", features: [] };
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hasMeaningfulReview(row) {
  const include = String(row.include ?? "").trim().toLowerCase();
  const status = String(row.status ?? "").trim().toLowerCase();
  const notes = String(row.notes ?? "").trim();
  return include === "true" || include === "yes" || Boolean(status) || Boolean(notes);
}

function roadValidation(road, observations, spatialFeatures) {
  const roadId = road.properties.id;
  const roadName = road.properties.name;
  const matchingRows = observations.filter((row) => {
    const haystack = [row.road_id, row.asset_id, row.road_name, row.notes].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(roadId.toLowerCase()) || haystack.includes(roadName.toLowerCase());
  });
  const matchingSpatial = spatialFeatures.filter((feature) => {
    const properties = feature.properties ?? {};
    const explicitRoad = String(properties.road_id ?? properties.asset_id ?? "").toLowerCase();
    if (explicitRoad === roadId.toLowerCase()) return true;
    return feature.geometry ? turf.booleanIntersects(road, feature) : false;
  });
  const metrics = roadMetrics.windows
    .filter((window) => window.window === "duringFlooding")
    .flatMap((window) => [...window.directRoadTouches, ...window.nearRoadTouches])
    .filter((item) => item.roadId === roadId);
  const validationStatus = validationStatusFor([...matchingRows, ...matchingSpatial.map((feature) => feature.properties ?? {})]);

  return {
    roadId,
    roadName,
    validationStatus,
    reviewedObservationCount: matchingRows.length,
    reviewedSpatialObservationCount: matchingSpatial.length,
    satelliteFlag: satelliteFlag(metrics),
    maxMappedFloodProbability: round(Math.max(0, ...metrics.map((item) => item.maxProbability ?? 0))),
    notes:
      validationStatus === "unverified"
        ? "No reviewer-approved field or official source has been attached to this road yet."
        : "Reviewer override provides field or official-source validation."
  };
}

function validationStatusFor(rows) {
  const statuses = rows.map((row) => String(row.status ?? row.validation_status ?? "").toLowerCase());
  if (statuses.some((status) => ["closed", "blocked", "impassable", "unsafe"].includes(status))) return "closed_verified";
  if (statuses.some((status) => ["open", "clear", "passable", "safe"].includes(status))) return "open_verified";
  if (rows.length > 0) return "reviewed_inconclusive";
  return "unverified";
}

function satelliteFlag(metrics) {
  if (metrics.some((item) => (item.probableCells ?? 0) > 0)) return "direct_probable_flood";
  if (metrics.some((item) => (item.possibleCells ?? 0) > 0)) return "direct_possible_flood";
  if (metrics.some((item) => (item.cellsWithin160m ?? 0) > 0)) return "nearby_flood";
  return "none";
}

async function findCandidateSources() {
  if (!process.env.EXA_API_KEY) return [];
  const during = scene.observationWindows.duringFlooding;
  const queries = [
    "Amboseli National Park flood road access March 2026 ranger",
    "Amboseli March 2026 flooding road closure KWS county",
    "Amboseli causeway flooding March 2026 police ranger"
  ];
  const results = [];
  for (const query of queries) {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.EXA_API_KEY
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: 5,
        startPublishedDate: `${during.start}T00:00:00.000Z`,
        endPublishedDate: `${during.end}T23:59:59.999Z`,
        contents: {
          highlights: true
        }
      })
    });
    if (!response.ok) continue;
    const payload = await response.json();
    for (const result of payload.results ?? []) {
      if (!hasUsableUrl(result)) continue;
      const text = [result.title, result.url, result.text, ...(Array.isArray(result.highlights) ? result.highlights : [])]
        .filter(Boolean)
        .join(" ");
      results.push({
        title: result.title ?? "Exa source",
        url: result.url,
        publishedDate: result.publishedDate,
        query,
        matchedRoadIds: matchRoadIds(text),
        reviewStatus: "candidate_unreviewed"
      });
    }
  }
  return dedupeByUrl(results).slice(0, 12);
}

function hasUsableUrl(result) {
  return typeof result.url === "string" && /^https?:\/\//.test(result.url);
}

function matchRoadIds(text) {
  const haystack = text.toLowerCase();
  return roads.features
    .filter((road) => haystack.includes(String(road.properties.name ?? "").toLowerCase()))
    .map((road) => road.properties.id);
}

function dedupeByUrl(results) {
  const seen = new Set();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
