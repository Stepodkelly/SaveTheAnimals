import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as turf from "@turf/turf";

const rootDir = process.cwd();
const windows = ["beforeFlooding", "duringFlooding", "recoveryComparison"];
const manifestPath = path.join(rootDir, "public/data/amboseli/sentinel1-flood-mask-manifest.json");
const assetManifestPath = path.join(
  rootDir,
  "versions/v2-forecast-mvp/data/assets/sentinel1/sentinel1_flood_mask_manifest.json"
);
const roadsPath = path.join(rootDir, "public/data/amboseli/roads.geojson");
const publicReportPath = path.join(rootDir, "public/data/amboseli/sentinel1-road-metrics.json");
const assetReportPath = path.join(rootDir, "versions/v2-forecast-mvp/data/reports/sentinel1_road_metrics.json");

for (const requiredPath of [manifestPath, roadsPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Missing ${path.relative(rootDir, requiredPath)}.`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const roads = JSON.parse(fs.readFileSync(roadsPath, "utf8"));
const roadMetrics = windows.map((windowKey) => metricsForWindow(windowKey, roads, manifest));
const changeLayer = manifest.changeLayer ? changeMetrics(manifest.changeLayer) : null;
const downloadedRasterChecksums = rasterChecksums();

for (const mask of manifest.masks) {
  const maskPath = path.join(rootDir, "public", mask.href);
  if (fs.existsSync(maskPath)) {
    mask.checksum = sha256(maskPath);
  }
}
if (manifest.changeLayer) {
  const changePath = path.join(rootDir, "public", manifest.changeLayer.href);
  if (fs.existsSync(changePath)) {
    manifest.changeLayer.checksum = sha256(changePath);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  method: "sentinel1-road-intersection-v0",
  caveat:
    "Metrics are computed from provisional Sentinel-1 planning masks against the demonstration road graph; they are not field-confirmed passability labels.",
  downloadedRasterChecksums,
  windows: roadMetrics,
  changeLayer
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(assetManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.mkdirSync(path.dirname(publicReportPath), { recursive: true });
fs.mkdirSync(path.dirname(assetReportPath), { recursive: true });
fs.writeFileSync(publicReportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(assetReportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${path.relative(rootDir, manifestPath)} with checksums`);
console.log(`Wrote ${path.relative(rootDir, assetManifestPath)} with checksums`);
console.log(`Wrote ${path.relative(rootDir, publicReportPath)}`);
console.log(`Wrote ${path.relative(rootDir, assetReportPath)}`);

function metricsForWindow(windowKey, roadsCollection, manifest) {
  const maskRecord = manifest.masks.find((mask) => mask.window === windowKey);
  if (!maskRecord) {
    return {
      window: windowKey,
      featureCount: 0,
      probableFloodAreaKm2: 0,
      directRoadTouches: [],
      nearRoadTouches: [],
      falseSafeRoadRate: 0,
      unnecessaryBlockRate: 0,
      routeAvailabilityProxy: 1
    };
  }

  const maskPath = path.join(rootDir, "public", maskRecord.href);
  const mask = JSON.parse(fs.readFileSync(maskPath, "utf8"));
  const probable = mask.features.filter((feature) => feature.properties.classification === "probable_flood");
  const possible = mask.features.filter((feature) => feature.properties.classification === "possible_flood");
  const directRoadTouches = [];
  const nearRoadTouches = [];

  for (const road of roadsCollection.features) {
    const probableTouches = probable.filter((feature) => turf.booleanIntersects(road, feature));
    const possibleTouches = possible.filter((feature) => turf.booleanIntersects(road, feature));
    const nearTouches = mask.features.filter((feature) => {
      const buffer = turf.buffer(feature, 0.16, { units: "kilometers" });
      return buffer ? turf.booleanIntersects(road, buffer) : false;
    });
    const maxProbability = Math.max(0, ...[...probableTouches, ...possibleTouches, ...nearTouches].map(
      (feature) => feature.properties.floodProbability
    ));

    if (probableTouches.length > 0 || possibleTouches.length > 0) {
      directRoadTouches.push({
        roadId: road.properties.id,
        roadName: road.properties.name,
        probableCells: probableTouches.length,
        possibleCells: possibleTouches.length,
        maxProbability: round(maxProbability)
      });
    }

    if (nearTouches.length > 0) {
      nearRoadTouches.push({
        roadId: road.properties.id,
        roadName: road.properties.name,
        cellsWithin160m: nearTouches.length,
        maxProbability: round(maxProbability)
      });
    }
  }

  const directProbableRoads = directRoadTouches.filter((road) => road.probableCells > 0);
  return {
    window: windowKey,
    observedAt: maskRecord.observedAt,
    sceneId: maskRecord.sceneId,
    featureCount: maskRecord.featureCount,
    probableFloodAreaKm2: maskRecord.probableFloodAreaKm2,
    directRoadTouches,
    nearRoadTouches,
    falseSafeRoadRate: 0,
    unnecessaryBlockRate: round(directProbableRoads.length / Math.max(1, roadsCollection.features.length)),
    routeAvailabilityProxy: directProbableRoads.length >= roadsCollection.features.length ? 0 : 1
  };
}

function changeMetrics(changeLayerRecord) {
  const changePath = path.join(rootDir, "public", changeLayerRecord.href);
  const change = JSON.parse(fs.readFileSync(changePath, "utf8"));
  const categories = change.features.reduce((summary, feature) => {
    summary[feature.properties.category] = (summary[feature.properties.category] ?? 0) + 1;
    return summary;
  }, {});
  return {
    href: changeLayerRecord.href,
    featureCount: change.features.length,
    categories
  };
}

function rasterChecksums() {
  const checksums = [];
  for (const windowKey of windows) {
    const downloadManifestPath = path.join(
      rootDir,
      `versions/v2-forecast-mvp/data/assets/sentinel1/download_manifest_${windowKey}.json`
    );
    if (!fs.existsSync(downloadManifestPath)) continue;
    const downloadManifest = JSON.parse(fs.readFileSync(downloadManifestPath, "utf8"));
    for (const asset of downloadManifest.downloaded ?? []) {
      const localPath = path.join(rootDir, asset.uri);
      if (!fs.existsSync(localPath)) continue;
      asset.localChecksum = sha256(localPath);
      checksums.push({
        window: windowKey,
        assetId: asset.assetId,
        sceneId: asset.sceneId,
        band: asset.band,
        sizeBytes: asset.sizeBytes,
        localChecksum: asset.localChecksum,
        sourceChecksum: asset.checksum
      });
    }
    fs.writeFileSync(downloadManifestPath, `${JSON.stringify(downloadManifest, null, 2)}\n`);
  }
  return checksums;
}

function sha256(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
