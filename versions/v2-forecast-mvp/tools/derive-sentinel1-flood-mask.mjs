import fs from "node:fs";
import path from "node:path";
import { fromFile } from "geotiff";
import { PNG } from "pngjs";

const rootDir = process.cwd();
const allWindows = ["beforeFlooding", "duringFlooding", "recoveryComparison"];
const requestedWindow = process.env.WINDOW_KEY ?? "all";
const windows = requestedWindow === "all" ? allWindows : [requestedWindow];
const scenesPerWindow = Number(process.env.SCENES_PER_WINDOW ?? 3);
const sampleWidth = Number(process.env.SAMPLE_WIDTH ?? 144);
const sampleHeight = Number(process.env.SAMPLE_HEIGHT ?? 126);
const cellsX = Number(process.env.CELLS_X ?? 48);
const cellsY = Number(process.env.CELLS_Y ?? 42);
const requireRawScenes = process.env.REQUIRE_RAW_SCENES === "true";
const probableFloodThreshold = Number(process.env.PROBABLE_FLOOD_THRESHOLD ?? 0.52);

const scenePath = path.join(rootDir, "public/data/amboseli/scene.json");
const quicklookManifestPath = path.join(rootDir, "public/data/amboseli/sentinel1-quicklooks/manifest.json");
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
const quicklookManifest = fs.existsSync(quicklookManifestPath)
  ? JSON.parse(fs.readFileSync(quicklookManifestPath, "utf8"))
  : { scenes: [] };
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
      id: "sentinel1-window-change-v1",
      description:
        "Cell-wise comparison of aggregated before, during and recovery Sentinel-1 flood-likelihood masks. Categories are provisional and intended for planning display."
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
  const pairs = await pairedSceneAssets(windowKey, stac, downloadManifest.downloaded ?? []);
  if (pairs.length === 0) {
    throw new Error(`Download manifest must contain at least one complete VV/VH scene pair for ${windowKey}.`);
  }

  const perScene = [];
  for (const pair of pairs) {
    const stacScene = (stac.features ?? []).find((feature) => feature.id === pair.sceneId);
    if (!stacScene?.bbox) {
      throw new Error(`STAC scene bbox not found for ${pair.sceneId}.`);
    }
    perScene.push(await scoreScenePair(pair, stacScene.bbox, scene.bounds));
  }

  const publicMaskPath = path.join(rootDir, `public/data/amboseli/sentinel1-flood-mask-${windowSlug(windowKey)}.geojson`);
  const features = aggregateSceneScores(windowKey, perScene, scene.bounds);
  const probableAreaM2 = features
    .filter((feature) => feature.properties.classification === "probable_flood")
    .reduce((total, feature) => total + feature.properties.areaM2, 0);
  const collection = {
    type: "FeatureCollection",
    features: features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        areaM2: undefined
      }
    }))
  };

  fs.mkdirSync(path.dirname(publicMaskPath), { recursive: true });
  fs.writeFileSync(publicMaskPath, `${JSON.stringify(collection, null, 2)}\n`);
  console.log(`Wrote ${path.relative(rootDir, publicMaskPath)} (${features.length} features from ${pairs.length} scenes)`);

  return {
    collection,
    record: {
      window: windowKey,
      href: `data/amboseli/sentinel1-flood-mask-${windowSlug(windowKey)}.geojson`,
      status: "generated",
      generatedAt: new Date().toISOString(),
      sceneId: pairs.map((pair) => pair.sceneId).join(","),
      sceneIds: pairs.map((pair) => pair.sceneId),
      observedAt: latest(pairs.map((pair) => pair.observedAt)),
      observedRange: {
        start: earliest(pairs.map((pair) => pair.observedAt)),
        end: latest(pairs.map((pair) => pair.observedAt))
      },
      sourceSceneCount: pairs.length,
      featureCount: features.length,
      probableFloodAreaKm2: round(probableAreaM2 / 1_000_000, 3),
      sourceAssetIds: pairs.flatMap(pairAssetIds),
      sourceUris: pairs.flatMap(pairUris),
      sourceSceneTypes: sourceTypeSummary(pairs),
      quality: qualitySummary(pairs),
      method: {
        id: "sentinel1-multiscene-hybrid-v3",
        description:
          "Aggregates local full Sentinel-1 VV/VH raster scene pairs with lower-weight Copernicus quicklook observations when full rasters are not local. Each scene is quantile-calibrated, smoothed with a 3x3 neighborhood, contrast-stretched after thresholding, and averaged by grid cell to reduce single-scene speckle. This is a provisional planning overlay, not a validated flood product.",
        aggregation: "source_weighted_mean_probability_across_selected_sentinel_scenes",
        sampleWidth,
        sampleHeight,
        cellsX,
        cellsY,
        probableFloodThreshold
      },
      georeference: {
        source: "Copernicus STAC bbox",
        note:
          "The local GeoTIFF reader did not expose affine tags for these COGs, so demo crops are linearly georeferenced from each STAC scene bbox."
      }
    }
  };
}

async function scoreScenePair(pair, sceneBbox, demoBbox) {
  if (pair.kind === "quicklook") return scoreQuicklookScene(pair);

  const vv = await readSceneCrop(pair.vv, sceneBbox, demoBbox);
  const vh = await readSceneCrop(pair.vh, sceneBbox, demoBbox);
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
    throw new Error(`No valid VV/VH pixels found inside the demo bounds for ${pair.sceneId}.`);
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

  return {
    pair,
    sourceWeight: 1,
    scoreThreshold,
    vvLow,
    vvMid,
    vhLow,
    vhMid,
    pixelScores,
    vvValues: vv.values,
    vhValues: vh.values
  };
}

function aggregateSceneScores(windowKey, perScene, demoBbox) {
  const cellPixelWidth = sampleWidth / cellsX;
  const cellPixelHeight = sampleHeight / cellsY;
  const features = [];

  for (let cellY = 0; cellY < cellsY; cellY += 1) {
    for (let cellX = 0; cellX < cellsX; cellX += 1) {
      const sceneCellScores = perScene.map((sceneScore) => scoreCell(sceneScore, cellX, cellY, cellPixelWidth, cellPixelHeight));
      const validCells = sceneCellScores.filter((cell) => cell.sampleCount > 0);
      if (validCells.length === 0) continue;

      const probability = clamp(weightedMean(validCells.map((cell) => [cell.probability, cell.sourceWeight])), 0, 1);
      const sourceCoverage = Math.min(
        validCells.reduce((total, cell) => total + cell.sourceWeight, 0) / Math.max(1, perScene.length),
        1
      );
      if (probability < 0.45) continue;
      const confidence = clamp(
        0.48 +
          Math.abs(probability - 0.5) * 0.62 +
          sourceCoverage * 0.18,
        0,
        0.94
      );

      const minLng = interpolate(demoBbox[0], demoBbox[2], cellX / cellsX);
      const maxLng = interpolate(demoBbox[0], demoBbox[2], (cellX + 1) / cellsX);
      const maxLat = interpolate(demoBbox[3], demoBbox[1], cellY / cellsY);
      const minLat = interpolate(demoBbox[3], demoBbox[1], (cellY + 1) / cellsY);
      const areaM2 = approxCellAreaM2(minLng, minLat, maxLng, maxLat);

      features.push({
        type: "Feature",
        properties: {
          cellId: `s1-${windowKey}-${cellY}-${cellX}`,
          window: windowKey,
          observedAt: latest(validCells.map((cell) => cell.observedAt)),
          sceneId: validCells.map((cell) => cell.sceneId).join(","),
          sceneIds: validCells.map((cell) => cell.sceneId),
          sourceSceneCount: validCells.length,
          floodProbability: round(probability, 3),
          confidence: round(confidence, 3),
          classification: probability >= probableFloodThreshold ? "probable_flood" : "possible_flood",
          vvMean: round(mean(validCells.map((cell) => cell.vvMean)), 2),
          vhMean: round(mean(validCells.map((cell) => cell.vhMean)), 2),
          method: "sentinel1-multiscene-hybrid-v3",
          georeference: "copernicus-stac-bbox-linearized",
          areaM2
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

  return features;
}

function scoreCell(sceneScore, cellX, cellY, cellPixelWidth, cellPixelHeight) {
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
      if (sceneScore.pixelScores[index] !== null) {
        samples.push(sceneScore.pixelScores[index]);
        vvSamples.push(sceneScore.vvValues[index]);
        vhSamples.push(sceneScore.vhValues[index]);
      }
    }
  }

  if (samples.length === 0) {
    return {
      sampleCount: 0,
      probability: 0,
      sourceWeight: sceneScore.sourceWeight,
      vvMean: 0,
      vhMean: 0,
      sceneId: sceneScore.pair.sceneId,
      observedAt: sceneScore.pair.observedAt
    };
  }

  const meanScore = mean(samples);
  return {
    sampleCount: samples.length,
    probability: clamp((meanScore - sceneScore.scoreThreshold + 0.5) * 1.18, 0, 1),
    sourceWeight: sceneScore.sourceWeight,
    vvMean: mean(vvSamples),
    vhMean: mean(vhSamples),
    sceneId: sceneScore.pair.sceneId,
    observedAt: sceneScore.pair.observedAt
  };
}

async function readSceneCrop(asset, sceneBbox, cropBbox) {
  const localPath = asset.uri ? path.join(rootDir, asset.uri) : null;
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error(`Missing local raster for ${asset.assetId}; selected raw scenes must be downloaded first.`);
  }
  const tiff = await fromFile(localPath);
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

async function pairedSceneAssets(windowKey, stac, localAssets) {
  const localByAssetId = new Map(localAssets.map((asset) => [asset.assetId, asset]));
  const quicklookBySceneId = new Map(
    (quicklookManifest.scenes ?? [])
      .filter((quicklook) => quicklook.window === windowKey)
      .map((quicklook) => [quicklook.sceneId, quicklook])
  );
  const eligibleScenes = [...(stac.features ?? [])]
    .filter((feature) => feature.assets?.vv?.alternate?.https?.href && feature.assets?.vh?.alternate?.https?.href)
    .sort((a, b) => String(a.properties?.datetime ?? "").localeCompare(String(b.properties?.datetime ?? "")));
  const selectedScenes = selectSceneSample(eligibleScenes, scenesPerWindow);
  const pairs = [];

  for (const feature of selectedScenes) {
    const vvAssetId = `sentinel1-${safeId(feature.id)}-vv`;
    const vhAssetId = `sentinel1-${safeId(feature.id)}-vh`;
    const vv = localByAssetId.get(vvAssetId);
    const vh = localByAssetId.get(vhAssetId);
    if (vv?.uri && vh?.uri && fs.existsSync(path.join(rootDir, vv.uri)) && fs.existsSync(path.join(rootDir, vh.uri))) {
      pairs.push({
        kind: "raw_vv_vh",
        sceneId: feature.id,
        observedAt: feature.properties?.datetime,
        vv,
        vh
      });
      continue;
    }

    if (requireRawScenes) {
      throw new Error(`Selected scene ${feature.id} is missing local VV/VH rasters and REQUIRE_RAW_SCENES=true.`);
    }

    const quicklook = quicklookBySceneId.get(feature.id);
    if (quicklook?.href && fs.existsSync(path.join(rootDir, "public", quicklook.href))) {
      pairs.push({
        kind: "quicklook",
        sceneId: feature.id,
        observedAt: feature.properties?.datetime,
        quicklook: {
          assetId: `sentinel1-${safeId(feature.id)}-quicklook`,
          uri: quicklook.href,
          sourceHref: quicklook.sourceHref
        }
      });
    }
  }

  return pairs.sort((a, b) => String(a.observedAt ?? "").localeCompare(String(b.observedAt ?? "")));
}

function selectSceneSample(scenes, count) {
  if (scenes.length <= count) return scenes;
  if (count <= 1) return [scenes.at(-1)];

  const indexes = new Set(
    Array.from({ length: count }, (_, index) => Math.round((index * (scenes.length - 1)) / (count - 1)))
  );
  return [...indexes].sort((a, b) => a - b).map((index) => scenes[index]);
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function scoreQuicklookScene(pair) {
  const pngPath = path.join(rootDir, "public", pair.quicklook.uri);
  const png = PNG.sync.read(fs.readFileSync(pngPath));
  const rawScores = [];

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const sourceX = Math.min(png.width - 1, Math.floor((x / sampleWidth) * png.width));
      const sourceY = Math.min(png.height - 1, Math.floor((y / sampleHeight) * png.height));
      const index = (sourceY * png.width + sourceX) * 4;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      const alpha = png.data[index + 3];
      if (alpha === 0) {
        rawScores.push(null);
        continue;
      }
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      rawScores.push(clamp((255 - luminance) / 255, 0, 1));
    }
  }

  const pixelScores = smoothScores(rawScores, sampleWidth, sampleHeight);
  const validScores = pixelScores.filter((value) => value !== null).sort((a, b) => a - b);
  const scoreThreshold = Math.max(0.52, percentile(validScores, 0.82));

  return {
    pair,
    sourceWeight: 0.45,
    scoreThreshold,
    pixelScores,
    vvValues: rawScores.map((value) => value ?? 0),
    vhValues: rawScores.map((value) => value ?? 0)
  };
}

function pairAssetIds(pair) {
  if (pair.kind === "quicklook") return [pair.quicklook.assetId];
  return [pair.vv.assetId, pair.vh.assetId];
}

function pairUris(pair) {
  if (pair.kind === "quicklook") return [pair.quicklook.uri];
  return [pair.vv.uri, pair.vh.uri];
}

function sourceTypeSummary(pairs) {
  return pairs.reduce((summary, pair) => {
    summary[pair.kind] = (summary[pair.kind] ?? 0) + 1;
    return summary;
  }, {});
}

function qualitySummary(pairs) {
  const rawSceneCount = pairs.filter((pair) => pair.kind === "raw_vv_vh").length;
  const quicklookSceneCount = pairs.filter((pair) => pair.kind === "quicklook").length;
  const fullRasterFraction = pairs.length === 0 ? 0 : rawSceneCount / pairs.length;
  return {
    fullRasterFraction: round(fullRasterFraction, 3),
    rawSceneCount,
    quicklookSceneCount,
    confidenceTier: fullRasterFraction >= 1 ? "strong" : rawSceneCount > 0 ? "mixed" : "quicklook_only",
    caveat:
      quicklookSceneCount > 0
        ? "Some selected scenes use lower-weight quicklook fallback rather than full VV/VH raster processing."
        : "All selected scenes use local full VV/VH raster pairs."
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
        method: "sentinel1-window-change-v1"
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
  if (duringProbability >= probableFloodThreshold && beforeProbability < 0.45) return "newly_flooded";
  if (beforeProbability >= probableFloodThreshold && duringProbability >= probableFloodThreshold) return "persistent_water";
  if (duringProbability >= probableFloodThreshold && recoveryProbability < 0.45) return "recovered_or_drying";
  if (recoveryProbability >= probableFloodThreshold && duringProbability < probableFloodThreshold) return "residual_or_later_water";
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
    return mean(neighbors);
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

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedMean(pairs) {
  const weightTotal = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  if (weightTotal === 0) return 0;
  return pairs.reduce((sum, [value, weight]) => sum + value * weight, 0) / weightTotal;
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

function earliest(values) {
  return [...values].filter(Boolean).sort()[0] ?? null;
}

function latest(values) {
  return [...values].filter(Boolean).sort().at(-1) ?? null;
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
