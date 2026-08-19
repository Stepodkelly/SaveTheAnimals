import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const rawDir = path.join(rootDir, "versions/v2-forecast-mvp/data/catalog/stac");
const publicDir = path.join(rootDir, "public/data/amboseli/sentinel1-quicklooks");
const versionedDir = path.join(rootDir, "versions/v2-forecast-mvp/data/catalog/quicklooks");
const windows = ["beforeFlooding", "duringFlooding", "recoveryComparison"];

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(versionedDir, { recursive: true });

const manifest = [];

for (const windowKey of windows) {
  const filePath = path.join(rawDir, `sentinel1_${windowKey}.json`);
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping ${windowKey}; STAC file is missing.`);
    continue;
  }

  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const features = Array.isArray(json.features) ? json.features : [];

  for (const feature of features) {
    const thumbnail = feature.assets?.thumbnail;
    if (!thumbnail?.href) continue;

    const filename = `${safeId(feature.id)}.png`;
    const publicPath = path.join(publicDir, filename);
    const versionedPath = path.join(versionedDir, filename);

    const bytes = await download(thumbnail.href);
    fs.writeFileSync(publicPath, bytes);
    fs.writeFileSync(versionedPath, bytes);

    manifest.push({
      sceneId: feature.id,
      window: windowKey,
      observedAt: feature.properties?.datetime ?? feature.properties?.start_datetime,
      platform: feature.properties?.platform,
      orbitState: feature.properties?.["sat:orbit_state"],
      relativeOrbit: feature.properties?.["sat:relative_orbit"],
      polarizations: feature.properties?.["sar:polarizations"] ?? [],
      href: `data/amboseli/sentinel1-quicklooks/${filename}`,
      sourceHref: thumbnail.href,
      productSize: feature.properties?._private?.product_size,
      productUuid: feature.properties?._private?.product_uuid
    });
  }
}

manifest.sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));

fs.writeFileSync(path.join(publicDir, "manifest.json"), `${JSON.stringify({ scenes: manifest }, null, 2)}\n`);
fs.writeFileSync(path.join(versionedDir, "manifest.json"), `${JSON.stringify({ scenes: manifest }, null, 2)}\n`);

console.log(`Downloaded ${manifest.length} Sentinel-1 quicklook(s).`);
console.log(`Public manifest: ${path.relative(rootDir, path.join(publicDir, "manifest.json"))}`);

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}
