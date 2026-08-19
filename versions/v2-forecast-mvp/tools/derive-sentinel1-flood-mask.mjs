import fs from "node:fs";
import path from "node:path";
import { fromFile } from "geotiff";

const rootDir = process.cwd();
const allWindows = ["beforeFlooding", "duringFlooding", "recoveryComparison"];
const requestedWindow = process.env.WINDOW_KEY ?? "all";
const windows = requestedWindow === "all" ? allWindows : [requestedWindow];
const sampleWidth = Number(process.env.SAMPLE_WIDTH ?? 144);
const sampleHeight = Number(process.env.SAMPLE_HEIGHT ?? 126);
const cellsX = Number(process.env.CELLS_X ?? 48);
const cellsY = Number(process.env.CELLS_Y ?? 42);

const scenePath = path.join(rootDir, "public/data/amboseli/scene.json");
const publicManifestPath = path.join(rootDir, "public/data/amboseli/sentinel1-flood-mask-manifest.json");
const publicChangePath = path.join(rootDir, "public/data/amboseli/sentinel1-flood-change.geojson");
const assetManifestPath = path.join(
  rootDir,
  "versions/v2-forecast-mvp/data/assets/sentinel1/sentinel1_flood_mask_manifest.json"
);

if (!fs.existsSync(scenePath)) {
  throw new Error(`Missing ${path.relative(rootDir, scenePath)}.`);
}

const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
const masks = [];
const collections = new Map();

for (const windowKey of windows) {
  const result = await deriveWindowMask(windowKey);
  masks.push(result.record);
  collections.set(windowKey, result.collection);
}

const manifest = {
  masks: mergeMaskRecords(readExistingManifest(publicManifestPath).masks ?? [], masks)
};

const allCollections = new Map(collections);
for (const record of manifest.masks) {
  if (!allCollections.has(record.window)) {
    const maskPath = path.join(rootDir, "public", record.href);
    if (fs.existsSync(maskPath)) {
      allCollections.set(record.window, JSON.parse(fs.readFileSync(maskPath, "utf8")));
    }
  }
}

if (allWindows.every((windowKey) => allCollections.has(windowKey))) {
  const changeCollection = deriveChangeCollection(allCollections);
  fs.writeFileSync(publicChangePath, `${JSON.stringify(changeCollection, null, 2)}\n`);
  manifest.changeLayer = {
    href: "data/amboseli/sentinel1-flood-change.geojson",
    status: "generated",
    generatedAt: new Date().toISOString(),
    method: {
      id: "sentinel1-window-change-v0",
      description:
        "Cell-wise comparison of before, during and recovery Sentinel-1 flood-likelihood masks. Categories are provisional and intended for planning display."
    },
    categories: changeSummary(changeCollection)
  };
  console.log(`Wrote ${path.relative(rootDir, publicChangePath)} (${changeCollection.features.length} features)`);
}

fs.mkdirSync(path.dirname(assetManifestPath), { recursive: true });
fs.writeFileSync(publicManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(assetManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${path.relative(rootDir, publicManifestPath)}`);
console.log(`Wrote ${path.relative(rootDir, assetManifestPath)}`);

async function deriveWindowMask(windowKey) {
  const stacPath = path.join(rootDir, `versions/v2-forecast-mvp/data/catalog/stac/sentinel1_${windowKey}.json`);
  const downloadManifestPath = path.join(
    rootDir,
    `versions/v2-forecast-mvp/data/assets/sentinel1/download_manifest_${windowKey}.json`
  );

  for (const requiredPath of [stacPath, downloadManifestPath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Missing ${path.relative(rootDir, requiredPath)}. Pull and download Sentinel-1 assets first.`);
    }
  }

  const stac = JSON.parse(fs.readFileSync(stacPath, "utf8"));
  const downloadManifest = JSON.parse(fs.readFileSync(downloadManifestPath, "utf8"));
  const downloaded = downloadManifest.downloaded ?? [];
  const vvAsset = downloaded.find((asset) => asset.band === "vv");
  const vhAsset = downloaded.find((asset) => asset.band === "vh");

  if (!vvAsset || !vhAsset) {
    throw new Error(`Download manifest must contain both vv and vh assets for ${windowKey}.`);
  }

  const stacScene = (stac.features ?? []).find((feature) => feature.id === vvAsset.sceneId);
  if (!stacScene?.bbox) {
    throw new Error(`STAC scene bbox not found for ${vvAsset.sceneId}.`);
  }

  const demoBbox = scene.bounds;
  const vvPath = path.join(rootDir, vvAsset.uri);
  const vhPath = path.join(rootDir, vhAsset.uri);
  const vv = await readSceneCrop(vvPath, stacScene.bbox, demoBbox);
  const vh = await readSceneCrop(vhPath, stacScene.bbox, demoBbox);
  const publicMaskPath = path.join(rootDir, `public/data/amboseli/sentinel1-flood-mask-${windowSlug(windowKey)}.geojson`);

  const validValues = [];
  for (let index = 0; index < vv.values.length; index += 1) {
    if (isValid(vv.values[index]) && isValid(vh.values[index])) {
      validValues.push({
        vv: vv.values[index],
        vh: vh.values[index]
      });
    }
  }

  if (validValues.length === 0) {
    throw new Error(`No valid VV/VH pixels found inside the demo bounds for ${windowKey}.`);
  }

  const vvValues = validValues.map((value) => value.vv).sort((a, b) => a - b);
  const vhValues = validValues.map((value) => value.vh).sort((a, b) => a - b);
  const vvLow = percentile(vvValues, 0.08);
  const vvMid = percentile(vvValues, 0.45);
  const vhLow = percentile(vhValues, 0.08);
  const vhMid = percentile(vhValues, 0.45);

  const rawPixelScores = Array.from({ length: vv.values.length }, (_, index) => {
    if (!isValid(vv.values[index]) || !isValid(vh.values[index])) return null;
    const vvScore = lowBackscatterScore(vv.values[index], vvLow, vvMid);
    const vhScore = lowBackscatterScore(vh.values[index], vhLow, vhMid);
    return clamp(vvScore * 0.65 + vhScore * 0.35, 0, 1);
  });
  const pixelScores = smoothScores(rawPixelScores, sampleWidth, sampleHeight);

  const validScores = pixelScores.filter((value) => value !== null).sort((a, b) => a - b);
  const scoreThreshold = Math.max(0.58, percentile(validScores, 0.84));
  const cellPixelWidth = sampleWidth / cellsX;
  const cellPixelHeight = sampleHeight / cellsY;
  const features = [];
  let probableAreaM2 = 0;

  for (let cellY = 0; cellY < cellsY; cellY += 1) {
    for (let cellX = 0; cellX < cellsX; cellX += 1) {
      const xStart = Math.floor(cellX * cellPixelWidth);
      const xEnd = Math.min(sampleWidth, Math.ceil((cellX + 1) * cellPixelWidth));
      const yStart = Math.floor(cellY * cellPixelHeight);
      const yEnd = Math.min(sampleHeight, Math.ceil((cellY + 1) * cellPixelHeight));
      const samples = [];
      const vvSamples = [];
      const vhSamples = [];

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const index = y * sampleWidth + x;
          if (pixelScores[index] !== null) {
            samples.push(pixelScores[index]);
            vvSamples.push(vv.values[index]);
            vhSamples.push(vh.values[index]);
          }
        }
      }

      if (samples.length === 0) continue;
      const meanScore = average(samples);
      const probability = clamp((meanScore - scoreThreshold + 0.5) * 0.95, 0, 1);
      if (probability < 0.45) continue;
      const confidence = clamp(0.5 + Math.abs(probability - 0.5) * 0.82 + Math.min(samples.length / 18, 1) * 0.08, 0, 0.92);

      const minLng = interpolate(demoBbox[0], demoBbox[2], cellX / cellsX);
      const maxLng = interpolate(demoBbox[0], demoBbox[2], (cellX + 1) / cellsX);
      const maxLat = interpolate(demoBbox[3], demoBbox[1], cellY / cellsY);
      const minLat = interpolate(demoBbox[3], demoBbox[1], (cellY + 1) / cellsY);
      const areaM2 = approxCellAreaM2(minLng, minLat, maxLng, maxLat);
      if (probability >= 0.62) probableAreaM2 += areaM2;

      features.push({
        type: "Feature",
        properties: {
          cellId: `s1-${windowKey}-${cellY}-${cellX}`,
          window: windowKey,
          observedAt: vvAsset.observedAt,
          sceneId: vvAsset.sceneId,
          floodProbability: round(probability, 3),
          confidence: round(confidence, 3),
          classification: probability >= 0.62 ? "probable_flood" : "possible_flood",
          vvMean: round(average(vvSamples), 2),
          vhMean: round(average(vhSamples), 2),
          method: "sentinel1-calibrated-low-backscatter-v1",
          georeference: "copernicus-stac-bbox-linearized"
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat]
            ]
          ]
        }
      });
    }
  }

  const collection = {
    type: "FeatureCollection",
    features
  };

  fs.mkdirSync(path.dirname(publicMaskPath), { recursive: true });
  fs.writeFileSync(publicMaskPath, `${JSON.stringify(collection, null, 2)}\n`);
  console.log(`Wrote ${path.relative(rootDir, publicMaskPath)} (${features.length} features)`);

  return {
    collection,
    record: {
      window: windowKey,
      href: `data/amboseli/sentinel1-flood-mask-${windowSlug(windowKey)}.geojson`,
      status: "generated",
      generatedAt: new Date().toISOString(),
      sceneId: vvAsset.sceneId,
      observedAt: vvAsset.observedAt,
      featureCount: features.length,
      probableFloodAreaKm2: round(probableAreaM2 / 1_000_000, 3),
      sourceAssetIds: [vvAsset.assetId, vhAsset.assetId],
      sourceUris: [vvAsset.uri, vhAsset.uri],
      method: {
        id: "sentinel1-calibrated-low-backscatter-v1",
        description:
          "Downsampled VV/VH low-backscatter likelihood clipped to the demo bounds, smoothed with a 3x3 neighborhood and calibrated per scene by quantiles. This is a provisional planning overlay, not a validated flood product.",
        scoreThreshold: round(scoreThreshold, 3),
        vvLow,
        vvMid,
        vhLow,
        vhMid,
        sampleWidth,
        sampleHeight,
        cellsX,
        cellsY
      },
      georeference: {
        source: "Copernicus STAC bbox",
        note:
          "The local GeoTIFF reader did not expose affine tags for this COG, so the demo crop is linearly georeferenced from the STAC scene bbox."
      }
    }
  };
}

async function readSceneCrop(tiffPath, sceneBbox, cropBbox) {
  const tiff = await fromFile(tiffPath);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const window = bboxToImageWindow(sceneBbox, cropBbox, width, height);
  const rasters = await image.readRasters({
    window,
    width: sampleWidth,
    height: sampleHeight
  });

  return {
    values: rasters[0],
    window,
    width,
    height
  };
}

function mergeMaskRecords(existingMasks, nextMasks) {
  const byWindow = new Map(existingMasks.map((mask) => [mask.window, mask]));
  nextMasks.forEach((mask) => byWindow.set(mask.window, mask));
  return allWindows.map((windowKey) => byWindow.get(windowKey)).filter(Boolean);
}

function readExistingManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { masks: [] };
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function windowSlug(windowKey) {
  if (windowKey === "beforeFlooding") return "before";
  if (windowKey === "recoveryComparison") return "recovery";
  return "during";
}

function deriveChangeCollection(collectionsByWindow) {
  const before = indexByGridCell(collectionsByWindow.get("beforeFlooding"));
  const during = indexByGridCell(collectionsByWindow.get("duringFlooding"));
  const recovery = indexByGridCell(collectionsByWindow.get("recoveryComparison"));
  const keys = new Set([...before.keys(), ...during.keys(), ...recovery.keys()]);
  const features = [];

  for (const key of [...keys].sort()) {
    const beforeFeature = before.get(key);
    const duringFeature = during.get(key);
    const recoveryFeature = recovery.get(key);
    const geometry = duringFeature?.geometry ?? recoveryFeature?.geometry ?? beforeFeature?.geometry;
    const beforeProbability = beforeFeature?.properties.floodProbability ?? 0;
    const duringProbability = duringFeature?.properties.floodProbability ?? 0;
    const recoveryProbability = recoveryFeature?.properties.floodProbability ?? 0;
    const category = changeCategory(beforeProbability, duringProbability, recoveryProbability);
    if (category === "background") continue;

    features.push({
      type: "Feature",
      properties: {
        cellId: `s1-change-${key}`,
        category,
        beforeProbability: round(beforeProbability, 3),
        duringProbability: round(duringProbability, 3),
        recoveryProbability: round(recoveryProbability, 3),
        deltaDuringBefore: round(duringProbability - beforeProbability, 3),
        deltaRecoveryDuring: round(recoveryProbability - duringProbability, 3),
        method: "sentinel1-window-change-v0"
      },
      geometry
    });
  }

  return {
    type: "FeatureCollection",
    features
  };
}

function indexByGridCell(collection) {
  const byCell = new Map();
  for (const feature of collection?.features ?? []) {
    const key = feature.properties.cellId.split("-").slice(-2).join("-");
    byCell.set(key, feature);
  }
  return byCell;
}

function changeCategory(beforeProbability, duringProbability, recoveryProbability) {
  if (duringProbability >= 0.62 && beforeProbability < 0.45) return "newly_flooded";
  if (beforeProbability >= 0.62 && duringProbability >= 0.62) return "persistent_water";
  if (duringProbability >= 0.62 && recoveryProbability < 0.45) return "recovered_or_drying";
  if (recoveryProbability >= 0.62 && duringProbability < 0.62) return "residual_or_later_water";
  if (duringProbability >= 0.45 || recoveryProbability >= 0.45 || beforeProbability >= 0.45) return "possible_change";
  return "background";
}

function changeSummary(collection) {
  return collection.features.reduce((summary, feature) => {
    const category = feature.properties.category;
    summary[category] = (summary[category] ?? 0) + 1;
    return summary;
  }, {});
}

function bboxToImageWindow(sceneBbox, cropBbox, imageWidth, imageHeight) {
  const [sceneMinLng, sceneMinLat, sceneMaxLng, sceneMaxLat] = sceneBbox;
  const [cropMinLng, cropMinLat, cropMaxLng, cropMaxLat] = cropBbox;
  const x0 = Math.max(0, Math.floor(((cropMinLng - sceneMinLng) / (sceneMaxLng - sceneMinLng)) * imageWidth));
  const x1 = Math.min(imageWidth, Math.ceil(((cropMaxLng - sceneMinLng) / (sceneMaxLng - sceneMinLng)) * imageWidth));
  const y0 = Math.max(0, Math.floor(((sceneMaxLat - cropMaxLat) / (sceneMaxLat - sceneMinLat)) * imageHeight));
  const y1 = Math.min(imageHeight, Math.ceil(((sceneMaxLat - cropMinLat) / (sceneMaxLat - sceneMinLat)) * imageHeight));
  return [x0, y0, x1, y1];
}

function lowBackscatterScore(value, low, mid) {
  if (mid === low) return 0;
  return clamp((mid - value) / (mid - low), 0, 1);
}

function smoothScores(scores, width, height) {
  return scores.map((score, index) => {
    if (score === null) return null;
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [];
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
        const value = scores[yy * width + xx];
        if (value !== null) neighbors.push(value);
      }
    }
    return average(neighbors);
  });
}

function percentile(sortedValues, q) {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function interpolate(start, end, t) {
  return start + (end - start) * t;
}

function approxCellAreaM2(minLng, minLat, maxLng, maxLat) {
  const latMeters = 111_320;
  const meanLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const lngMeters = 111_320 * Math.cos(meanLat);
  return Math.abs((maxLng - minLng) * lngMeters * (maxLat - minLat) * latMeters);
}

function isValid(value) {
  return Number.isFinite(value) && value > 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
