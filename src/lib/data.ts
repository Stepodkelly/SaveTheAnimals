import type {
  FloodCollection,
  LocationsData,
  RoadCollection,
  SceneMetadata,
  V2ReplayCellCollection
} from "../types";

export async function loadDemoData() {
  const base = import.meta.env.BASE_URL;
  const [scene, roads, floods, locations, v2ReplayCells] = await Promise.all([
    fetch(`${base}data/amboseli/scene.json`).then((res) => res.json() as Promise<SceneMetadata>),
    fetch(`${base}data/amboseli/roads.geojson`).then((res) => res.json() as Promise<RoadCollection>),
    fetch(`${base}data/amboseli/flood-polygons.geojson`).then((res) => res.json() as Promise<FloodCollection>),
    fetch(`${base}data/amboseli/locations.json`).then((res) => res.json() as Promise<LocationsData>),
    fetch(`${base}data/amboseli/v2-replay-cells.geojson`).then(
      (res) => res.json() as Promise<V2ReplayCellCollection>
    )
  ]);

  return { scene, roads, floods, locations, v2ReplayCells };
}
