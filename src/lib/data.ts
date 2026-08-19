import type {
  FloodCollection,
  LocationsData,
  RoadCollection,
  SatelliteFloodChangeCollection,
  SatelliteFloodMaskCollection,
  SceneMetadata,
  SentinelFloodMaskManifest,
  SentinelQuicklookManifest,
  SentinelRoadMetricsReport,
  V2ReplayCellCollection
} from "../types";

export async function loadDemoData() {
  const base = import.meta.env.BASE_URL;
  const emptyFloodMask: SatelliteFloodMaskCollection = { type: "FeatureCollection", features: [] };
  const emptyFloodChange: SatelliteFloodChangeCollection = { type: "FeatureCollection", features: [] };
  const emptyMaskManifest: SentinelFloodMaskManifest = { masks: [] };
  const emptyRoadMetrics: SentinelRoadMetricsReport = {
    generatedAt: "",
    method: "missing",
    caveat: "",
    windows: [],
    changeLayer: null
  };
  const [scene, roads, floods, locations, v2ReplayCells, sentinelQuicklooks, floodMaskManifest, roadMetrics] =
    await Promise.all([
    fetch(`${base}data/amboseli/scene.json`).then((res) => res.json() as Promise<SceneMetadata>),
    fetch(`${base}data/amboseli/roads.geojson`).then((res) => res.json() as Promise<RoadCollection>),
    fetch(`${base}data/amboseli/flood-polygons.geojson`).then((res) => res.json() as Promise<FloodCollection>),
    fetch(`${base}data/amboseli/locations.json`).then((res) => res.json() as Promise<LocationsData>),
    fetch(`${base}data/amboseli/v2-replay-cells.geojson`).then(
      (res) => res.json() as Promise<V2ReplayCellCollection>
    ),
    fetch(`${base}data/amboseli/sentinel1-quicklooks/manifest.json`).then(
      (res) => res.json() as Promise<SentinelQuicklookManifest>
    ),
    loadJsonOrDefault<SentinelFloodMaskManifest>(
      `${base}data/amboseli/sentinel1-flood-mask-manifest.json`,
      emptyMaskManifest
    ),
    loadJsonOrDefault<SentinelRoadMetricsReport>(
      `${base}data/amboseli/sentinel1-road-metrics.json`,
      emptyRoadMetrics
    )
  ]);
  const satelliteFloodMask = await loadSatelliteMasks(base, floodMaskManifest, emptyFloodMask);
  const satelliteFloodChange = floodMaskManifest.changeLayer?.status === "generated"
    ? await loadJsonOrDefault<SatelliteFloodChangeCollection>(
        `${base}${floodMaskManifest.changeLayer.href}`,
        emptyFloodChange
      )
    : emptyFloodChange;

  return {
    scene,
    roads,
    floods,
    locations,
    v2ReplayCells,
    sentinelQuicklooks,
    satelliteFloodMask,
    satelliteFloodChange,
    floodMaskManifest,
    roadMetrics
  };
}

async function loadSatelliteMasks(
  base: string,
  manifest: SentinelFloodMaskManifest,
  fallback: SatelliteFloodMaskCollection
): Promise<SatelliteFloodMaskCollection> {
  const collections = await Promise.all(
    manifest.masks
      .filter((mask) => mask.status === "generated")
      .map((mask) => loadJsonOrDefault<SatelliteFloodMaskCollection>(`${base}${mask.href}`, fallback))
  );
  return {
    type: "FeatureCollection",
    features: collections.flatMap((collection) => collection.features)
  };
}

async function loadJsonOrDefault<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(url);
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}
