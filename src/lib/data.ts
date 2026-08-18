import type {
  FloodCollection,
  LocationsData,
  RoadCollection,
  SceneMetadata
} from "../types";

export async function loadDemoData() {
  const [scene, roads, floods, locations] = await Promise.all([
    fetch("/data/amboseli/scene.json").then((res) => res.json() as Promise<SceneMetadata>),
    fetch("/data/amboseli/roads.geojson").then((res) => res.json() as Promise<RoadCollection>),
    fetch("/data/amboseli/flood-polygons.geojson").then((res) => res.json() as Promise<FloodCollection>),
    fetch("/data/amboseli/locations.json").then((res) => res.json() as Promise<LocationsData>)
  ]);

  return { scene, roads, floods, locations };
}
