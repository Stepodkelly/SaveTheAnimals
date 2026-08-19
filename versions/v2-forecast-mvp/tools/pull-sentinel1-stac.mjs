import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const stacEndpoint = "https://stac.dataspace.copernicus.eu/v1/search";
const scenePath = path.join(rootDir, "public/data/amboseli/scene.json");
const catalogDir = path.join(rootDir, "versions/v2-forecast-mvp/data/catalog");
const rawDir = path.join(catalogDir, "stac");

const windows = {
  beforeFlooding: {
    label: "Before flooding",
    start: "2026-01-15",
    end: "2026-02-20"
  },
  duringFlooding: {
    label: "During flooding",
    start: "2026-03-09",
    end: "2026-03-20"
  },
  recoveryComparison: {
    label: "Recovery comparison",
    start: "2026-05-07",
    end: "2026-05-15"
  }
};

const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
const bbox = scene.bounds;

fs.mkdirSync(rawDir, { recursive: true });

const rows = [];
const summary = [];

for (const [windowKey, window] of Object.entries(windows)) {
  const payload = {
    collections: ["sentinel-1-grd"],
    bbox,
    datetime: `${window.start}T00:00:00Z/${window.end}T23:59:59Z`,
    limit: 100
  };

  const json = await postJson(stacEndpoint, payload);
  const features = Array.isArray(json.features) ? json.features : [];
  const rawPath = path.join(rawDir, `sentinel1_${windowKey}.json`);
  fs.writeFileSync(rawPath, `${JSON.stringify(json, null, 2)}\n`);

  for (const feature of features) {
    rows.push(sceneRow(windowKey, feature));
  }

  summary.push({
    windowKey,
    label: window.label,
    start: window.start,
    end: window.end,
    scenes: features.length,
    rawPath: path.relative(rootDir, rawPath)
  });
}

rows.sort((a, b) => a.observation_date.localeCompare(b.observation_date) || a.scene_id.localeCompare(b.scene_id));

const csvPath = path.join(catalogDir, "sentinel1_scenes.csv");
fs.writeFileSync(csvPath, toCsv(rows));

const summaryPath = path.join(rawDir, "sentinel1_pull_summary.json");
fs.writeFileSync(
  summaryPath,
  `${JSON.stringify(
    {
      pulledAt: new Date().toISOString(),
      endpoint: stacEndpoint,
      collection: "sentinel-1-grd",
      bbox,
      windows: summary
    },
    null,
    2
  )}\n`
);

console.log(`Wrote ${rows.length} Sentinel-1 catalogue rows to ${path.relative(rootDir, csvPath)}`);
for (const item of summary) {
  console.log(`${item.windowKey}: ${item.scenes} scene(s)`);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`STAC request failed ${response.status}: ${body.slice(0, 500)}`);
  }

  return response.json();
}

function sceneRow(windowKey, feature) {
  const properties = feature.properties ?? {};
  const assets = feature.assets ?? {};
  const orbit = properties["sat:relative_orbit"] ?? properties.relativeOrbitNumber ?? "";
  const pass = properties["sat:orbit_state"] ?? properties.orbitDirection ?? "";
  const polarizations = properties["sar:polarizations"] ?? properties.polarizations ?? [];
  const processingBaseline = properties.processingBaseline ?? properties["s1:processing_baseline"] ?? "";

  return {
    scene_id: feature.id ?? properties.id ?? "",
    observation_date: properties.datetime ?? properties.start_datetime ?? "",
    satellite: properties.platform ?? "",
    product: properties.productType ?? properties["s1:product_type"] ?? "GRD",
    relative_orbit: orbit,
    pass_direction: pass,
    polarizations: Array.isArray(polarizations) ? polarizations.join("+") : String(polarizations),
    aoi_coverage: coverageHint(feature),
    processing_baseline: processingBaseline,
    window: windowKey,
    stac_url: feature.links?.find((link) => link.rel === "self")?.href ?? "",
    vv_asset: assets.vv?.alternate?.https?.href ?? assets.vv?.href ?? "",
    vh_asset: assets.vh?.alternate?.https?.href ?? assets.vh?.href ?? "",
    thumbnail_asset: assets.thumbnail?.href ?? "",
    product_asset: assets.Product?.href ?? assets.product?.href ?? ""
  };
}

function coverageHint(feature) {
  const bbox = feature.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) return "";
  return "intersects_bbox";
}

function toCsv(rows) {
  const headers = [
    "scene_id",
    "observation_date",
    "satellite",
    "product",
    "relative_orbit",
    "pass_direction",
    "polarizations",
    "aoi_coverage",
    "processing_baseline",
    "window",
    "stac_url",
    "vv_asset",
    "vh_asset",
    "thumbnail_asset",
    "product_asset"
  ];

  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
