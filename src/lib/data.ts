import type {
  FloodCollection,
  LocationsData,
  RoadCollection,
  SatelliteFloodMaskCollection,
  SceneMetadata,
  SentinelFloodMaskManifest,
  SentinelQuicklookManifest,
  V2ReplayCellCollection
} from "../types";

export async function loadDemoData() {
  const base = import.meta.env.BASE_URL;
  const emptyFloodMask: SatelliteFloodMaskCollection = { type: "FeatureCollection", features: [] };
  const emptyMaskManifest: SentinelFloodMaskManifest = { masks: [] };
  const [scene, roads, floods, locations, v2ReplayCells, sentinelQuicklooks, satelliteFloodMask, floodMaskManifest] =
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
    loadJsonOrDefault<SatelliteFloodMaskCollection>(
      `${base}data/amboseli/sentinel1-flood-mask-during.geojson`,
      emptyFloodMask
    ),
    loadJsonOrDefault<SentinelFloodMaskManifest>(
      `${base}data/amboseli/sentinel1-flood-mask-manifest.json`,
      emptyMaskManifest
    )
  ]);

  return { scene, roads, floods, locations, v2ReplayCells, sentinelQuicklooks, satelliteFloodMask, floodMaskManifest };
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
