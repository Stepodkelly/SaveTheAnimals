import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { loadProjectEnv } from "./env.mjs";

const rootDir = process.cwd();
loadProjectEnv(rootDir);
const stacDir = path.join(rootDir, "versions/v2-forecast-mvp/data/catalog/stac");
const outputDir = path.join(rootDir, "versions/v2-forecast-mvp/data/raw/sentinel1");
const manifestDir = path.join(rootDir, "versions/v2-forecast-mvp/data/assets/sentinel1");
const windowKey = process.env.WINDOW_KEY ?? "duringFlooding";
const sceneId = process.env.SCENE_ID;
const bands = (process.env.BANDS ?? "vv,vh").split(",").map((band) => band.trim()).filter(Boolean);
const limit = Number(process.env.LIMIT ?? 1);
const allowLargeDownload = process.env.CONFIRM_LARGE_DOWNLOAD === "true";
const token = await getAccessToken();

if (!allowLargeDownload) {
  throw new Error(
    "Refusing large Sentinel-1 download until CONFIRM_LARGE_DOWNLOAD=true is set. First run npm run v2:probe-sentinel1-rasters."
  );
}

if (!token) {
  throw new Error("Missing Copernicus credentials. Set CDSE_ACCESS_TOKEN, CDSE_REFRESH_TOKEN, or CDSE_USERNAME/CDSE_PASSWORD.");
}

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(manifestDir, { recursive: true });

const stacPath = path.join(stacDir, `sentinel1_${windowKey}.json`);
if (!fs.existsSync(stacPath)) {
  throw new Error(`Missing STAC file: ${path.relative(rootDir, stacPath)}. Run npm run v2:pull-sentinel1 first.`);
}

const stac = JSON.parse(fs.readFileSync(stacPath, "utf8"));
const scenes = sceneId
  ? (stac.features ?? []).filter((scene) => scene.id === sceneId)
  : (stac.features ?? []).slice(0, limit);
if (sceneId && scenes.length === 0) {
  throw new Error(`SCENE_ID ${sceneId} was not found in ${path.relative(rootDir, stacPath)}.`);
}
const downloaded = [];

for (const scene of scenes) {
  for (const band of bands) {
    const asset = scene.assets?.[band];
    const href = asset?.alternate?.https?.href;
    if (!href) continue;

    const filename = `${safeId(scene.id)}_${band}.tif`;
    const outputPath = path.join(outputDir, filename);
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      downloaded.push(assetRecord(scene, band, asset, outputPath, stats.size, href));
      console.log(`Using existing ${path.relative(rootDir, outputPath)} (${stats.size} bytes)`);
      continue;
    }

    const response = await fetch(href, {
      redirect: "follow",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok || !response.body) {
      throw new Error(`Download failed ${response.status}: ${scene.id} ${band}`);
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(outputPath));
    const stats = fs.statSync(outputPath);

    downloaded.push(assetRecord(scene, band, asset, outputPath, stats.size, href));

    console.log(`Downloaded ${path.relative(rootDir, outputPath)} (${stats.size} bytes)`);
  }
}

const manifestPath = path.join(manifestDir, `download_manifest_${windowKey}.json`);
fs.writeFileSync(manifestPath, `${JSON.stringify({ downloaded }, null, 2)}\n`);
console.log(`Wrote ${path.relative(rootDir, manifestPath)}`);

async function getAccessToken() {
  if (process.env.CDSE_ACCESS_TOKEN) return process.env.CDSE_ACCESS_TOKEN;
  if (process.env.CDSE_REFRESH_TOKEN) {
    return requestToken({
      grant_type: "refresh_token",
      refresh_token: process.env.CDSE_REFRESH_TOKEN,
      client_id: "cdse-public"
    });
  }
  if (process.env.CDSE_USERNAME && process.env.CDSE_PASSWORD) {
    return requestToken({
      grant_type: "password",
      username: process.env.CDSE_USERNAME,
      password: process.env.CDSE_PASSWORD,
      client_id: "cdse-public"
    });
  }
  return null;
}

async function requestToken(fields) {
  const response = await fetch(
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(fields)
    }
  );

  if (!response.ok) {
    throw new Error(`CDSE token request failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  if (!payload.access_token) throw new Error("CDSE token response did not include access_token.");
  return payload.access_token;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function assetRecord(scene, band, asset, outputPath, sizeBytes, href) {
  return {
    assetId: `sentinel1-${safeId(scene.id)}-${band}`,
    assetType: "raw_scene",
    sceneId: scene.id,
    band,
    uri: path.relative(rootDir, outputPath),
    expectedSizeBytes: asset["file:size"] ?? null,
    sizeBytes,
    createdAt: new Date().toISOString(),
    availableAt: scene.properties?.published ?? scene.properties?.datetime,
    observedAt: scene.properties?.datetime,
    platform: scene.properties?.platform,
    checksum: asset["file:checksum"] ?? null,
    sourceHref: href,
    gridVersion: "amboseli-30m-v1",
    crs: asset["proj:code"] ?? "unknown",
    bounds: scene.bbox ?? [],
    resolutionMeters: 10,
    nodataValue: asset.nodata ?? 0,
    sourceAssetIds: [],
    parentJobId: `download-sentinel1-rasters:${windowKey}:${scene.id}:${band}`
  };
}
