import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const reportDir = path.join(rootDir, "versions/v2-forecast-mvp/data/reports");
fs.mkdirSync(reportDir, { recursive: true });

const checks = {
  gdalinfo: commandExists("gdalinfo"),
  gdal_translate: commandExists("gdal_translate"),
  python: commandExists("python3"),
  rasterio: pythonModule("rasterio"),
  numpy: pythonModule("numpy"),
  shapely: pythonModule("shapely"),
  geopandas: pythonModule("geopandas")
};

const readyForRasterFloodMasks =
  (checks.gdalinfo && checks.gdal_translate) || (checks.python && checks.rasterio && checks.numpy);

const report = {
  checkedAt: new Date().toISOString(),
  checks,
  readyForRasterFloodMasks,
  nextAction: readyForRasterFloodMasks
    ? "Run authenticated Sentinel-1 raster download and flood-mask derivation."
    : "Install GDAL or Python rasterio before deriving flood masks from VV/VH rasters."
};

fs.writeFileSync(
  path.join(reportDir, "geospatial_tooling_report.json"),
  `${JSON.stringify(report, null, 2)}\n`
);

console.log(JSON.stringify(report, null, 2));
if (!readyForRasterFloodMasks) process.exitCode = 2;

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" }).status === 0;
}

function pythonModule(moduleName) {
  const result = spawnSync("python3", ["-c", `import ${moduleName}`], { encoding: "utf8" });
  return result.status === 0;
}
