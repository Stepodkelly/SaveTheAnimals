import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const stacDir = path.join(rootDir, "versions/v2-forecast-mvp/data/catalog/stac");
const reportDir = path.join(rootDir, "versions/v2-forecast-mvp/data/reports");
const windowKey = process.env.WINDOW_KEY ?? "duringFlooding";
const bands = (process.env.BANDS ?? "vv,vh").split(",").map((band) => band.trim()).filter(Boolean);
const limit = Number(process.env.LIMIT ?? 1);
const token = await getAccessToken();

fs.mkdirSync(reportDir, { recursive: true });

const stacPath = path.join(stacDir, `sentinel1_${windowKey}.json`);
if (!fs.existsSync(stacPath)) {
  throw new Error(`Missing STAC file: ${path.relative(rootDir, stacPath)}. Run npm run v2:pull-sentinel1 first.`);
}

const stac = JSON.parse(fs.readFileSync(stacPath, "utf8"));
const scenes = (stac.features ?? []).slice(0, limit);
const checks = [];

for (const scene of scenes) {
  for (const band of bands) {
    const asset = scene.assets?.[band];
    const href = asset?.alternate?.https?.href;
    if (!href) {
      checks.push({
        sceneId: scene.id,
        band,
        status: "missing_asset",
        httpStatus: null,
        contentType: null,
        sizeBytes: asset?.["file:size"] ?? null
      });
      continue;
    }

    const response = await fetch(href, {
      redirect: "follow",
      headers: {
        Range: "bytes=0-31",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    checks.push({
      sceneId: scene.id,
      band,
      status: response.ok ? "readable" : "blocked",
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      sizeBytes: asset["file:size"] ?? null,
      authUsed: Boolean(token),
      href
    });
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  windowKey,
  limit,
  bands,
  tokenAvailable: Boolean(token),
  credentialSources: {
    CDSE_ACCESS_TOKEN: Boolean(process.env.CDSE_ACCESS_TOKEN),
    CDSE_REFRESH_TOKEN: Boolean(process.env.CDSE_REFRESH_TOKEN),
    CDSE_USERNAME: Boolean(process.env.CDSE_USERNAME),
    CDSE_PASSWORD: Boolean(process.env.CDSE_PASSWORD)
  },
  checks
};

const reportPath = path.join(reportDir, "sentinel1_raster_access_report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${path.relative(rootDir, reportPath)}`);
for (const check of checks) {
  console.log(`${check.sceneId} ${check.band}: ${check.status} (${check.httpStatus ?? "n/a"})`);
}

if (checks.some((check) => check.status === "blocked")) {
  process.exitCode = 2;
}

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
  const body = new URLSearchParams(fields);
  const response = await fetch(
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    }
  );

  if (!response.ok) {
    throw new Error(`CDSE token request failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  if (!payload.access_token) throw new Error("CDSE token response did not include access_token.");
  return payload.access_token;
}
