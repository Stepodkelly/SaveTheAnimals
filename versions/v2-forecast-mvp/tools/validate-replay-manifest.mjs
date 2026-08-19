import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const defaultPath =
  "versions/v2-forecast-mvp/data/replays/amboseli-2026-march/replay_manifest.json";
const manifestPath = resolve(process.argv[2] ?? defaultPath);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const errors = [];
const warnings = [];

const requiredFields = [
  "manifestId",
  "replayId",
  "aoiId",
  "gridVersion",
  "asOf",
  "validAt",
  "heldOutEventId",
  "allowedObservationLatestAt",
  "rainfallMode",
  "inputAssets",
  "excludedEventIds",
  "modelVersions",
  "postProcessorVersion",
];

for (const field of requiredFields) {
  if (manifest[field] === undefined || manifest[field] === null) {
    errors.push(`Missing required field: ${field}`);
  }
}

const asOf = parseDate("asOf", manifest.asOf);
const validAt = parseDate("validAt", manifest.validAt);
const latestObservation = parseDate(
  "allowedObservationLatestAt",
  manifest.allowedObservationLatestAt,
);

if (asOf && validAt && validAt <= asOf) {
  errors.push("validAt must be after asOf.");
}

if (asOf && latestObservation && latestObservation > asOf) {
  errors.push("allowedObservationLatestAt cannot be after asOf.");
}

if (!["observed_hindsight", "issued_forecast"].includes(manifest.rainfallMode)) {
  errors.push("rainfallMode must be observed_hindsight or issued_forecast.");
}

if (!Array.isArray(manifest.excludedEventIds) || manifest.excludedEventIds.length === 0) {
  errors.push("excludedEventIds must include at least the held-out event.");
} else if (!manifest.excludedEventIds.includes(manifest.heldOutEventId)) {
  errors.push("excludedEventIds must include heldOutEventId.");
}

if (!Array.isArray(manifest.inputAssets)) {
  errors.push("inputAssets must be an array.");
} else {
  for (const [index, asset] of manifest.inputAssets.entries()) {
    validateAsset(asset, index);
  }
}

const checks = manifest.leakageChecks ?? {};
for (const check of [
  "rejectInputsAfterAsOf",
  "rebuildHistoricalFeaturesWithoutHeldOutEvent",
  "rejectReviewOverridesAfterAsOf",
]) {
  if (checks[check] !== true) {
    errors.push(`Leakage check must be true: ${check}`);
  }
}

if (errors.length > 0) {
  console.error(`Replay manifest failed validation: ${manifestPath}`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Replay manifest passed validation: ${manifestPath}`);
console.log(`Replay: ${manifest.replayId}`);
console.log(`As of: ${manifest.asOf}`);
console.log(`Valid at: ${manifest.validAt}`);
console.log(`Input assets: ${manifest.inputAssets.length}`);

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

function validateAsset(asset, index) {
  const prefix = `inputAssets[${index}]`;

  for (const field of ["assetId", "role", "availableAt"]) {
    if (!asset[field]) {
      errors.push(`${prefix} missing ${field}.`);
    }
  }

  const availableAt = parseDate(`${prefix}.availableAt`, asset.availableAt);
  if (!asOf || !availableAt) {
    return;
  }

  if (asset.role === "static_geography") {
    if (availableAt > asOf) {
      warnings.push(`${prefix} is static geography but availableAt is after asOf.`);
    }
    return;
  }

  if (availableAt > asOf) {
    errors.push(`${prefix} is newer than asOf: ${asset.assetId}`);
  }
}

function parseDate(label, value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    errors.push(`${label} must be a valid date-time.`);
    return null;
  }
  return date;
}
