import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const docsDir = path.join(rootDir, "docs");
const requiredFiles = ["index.html", "404.html", "manifest.webmanifest", "sw.js", "icon.svg"];
const failures = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(docsDir, file))) failures.push(`Missing docs/${file}`);
}

const indexHtml = read("index.html");
const manifest = JSON.parse(read("manifest.webmanifest"));
const serviceWorker = read("sw.js");
const assetMatches = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((href) => href.startsWith("/SaveTheAnimals/"))
  .map((href) => href.replace("/SaveTheAnimals/", ""));

for (const asset of assetMatches) {
  if (!fs.existsSync(path.join(docsDir, asset))) failures.push(`Referenced asset missing: docs/${asset}`);
}

if (manifest.name !== "#save_the_animals") failures.push("PWA manifest name is not #save_the_animals");
if (manifest.display !== "standalone") failures.push("PWA manifest display is not standalone");
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) failures.push("PWA manifest has no icons");
if (!indexHtml.includes('rel="manifest"')) failures.push("Built index.html does not reference the manifest");
if (!serviceWorker.includes("fetch")) failures.push("Service worker does not include a fetch handler");

const report = {
  checkedAt: new Date().toISOString(),
  ok: failures.length === 0,
  checkedFiles: requiredFiles.map((file) => `docs/${file}`),
  referencedAssets: assetMatches.map((asset) => `docs/${asset}`),
  manifest: {
    name: manifest.name,
    shortName: manifest.short_name,
    display: manifest.display,
    startUrl: manifest.start_url,
    scope: manifest.scope
  },
  failures
};

const reportPath = path.join(rootDir, "versions/v2-forecast-mvp/data/reports/pwa_verification_report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

function read(file) {
  const filePath = path.join(docsDir, file);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}
