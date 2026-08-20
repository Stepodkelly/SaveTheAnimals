import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, LineString } from "geojson";
import type {
  IncidentLocation,
  LocationsData,
  ObservationWindowKey,
  RoadEdge,
  RouteResult,
  SatelliteFloodChangeCollection,
  SatelliteFloodChangeProperties,
  SatelliteFloodMaskCollection,
  SatelliteFloodMaskProperties,
  V2ReplayEvaluation,
  V2ScoredCellProperties
} from "../types";
import { routeFeatures } from "../lib/routing";
import { filterSatelliteMask } from "../lib/sentinelMasks";

type RescueMapProps = {
  locations: LocationsData;
  edges: RoadEdge[];
  currentRoute: RouteResult;
  rejectedRoute: RouteResult | null;
  selectedIncident: IncidentLocation;
  showFlood: boolean;
  activeWindow: ObservationWindowKey;
  v2Replay: V2ReplayEvaluation | null;
  satelliteFloodMask: SatelliteFloodMaskCollection;
  satelliteFloodChange: SatelliteFloodChangeCollection;
  satelliteLayerMode: "mask" | "change";
};

export function RescueMap({
  locations,
  edges,
  currentRoute,
  rejectedRoute,
  selectedIncident,
  showFlood,
  activeWindow,
  v2Replay,
  satelliteFloodMask,
  satelliteFloodChange,
  satelliteLayerMode
}: RescueMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false
    }).setView([-2.653, 37.266], 13);

    L.control.zoom({ position: "bottomleft" }).addTo(map);
    L.control
      .attribution({ position: "bottomright", prefix: false })
      .addAttribution("Map data OpenStreetMap")
      .addTo(map);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
      maxZoom: 18,
      opacity: 0.94,
      attribution: "Satellite imagery Esri"
      }
    ).addTo(map);

    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;

    layers.clearLayers();

    const roadFeatures: FeatureCollection<LineString> = {
        type: "FeatureCollection",
        features: edges.map((edge) => ({
          type: "Feature",
          properties: edge,
          geometry: edge.geometry
        }))
      };
    const activeSatelliteMask = filterSatelliteMask(satelliteFloodMask, activeWindow);

    if (v2Replay && activeWindow === "duringFlooding" && showFlood) {
      layers.addLayer(
        L.geoJSON(v2Replay.cells, {
          style: (feature) => {
            const cell = feature?.properties as V2ScoredCellProperties;
            return {
              color: riskColor(cell.probability),
              fillColor: riskColor(cell.probability),
              weight: 1,
              opacity: 0.82,
              fillOpacity: 0.28
            };
          },
          onEachFeature: (feature, layer) => {
            const cell = feature.properties as V2ScoredCellProperties;
            layer.bindTooltip(
              `${cell.label}: ${Math.round(cell.probability * 100)}% ${cell.model.replace(
                "-v1",
                ""
              )} model predicted risk`
            );
          }
        })
      );
    }

    if (showFlood && satelliteLayerMode === "change" && satelliteFloodChange.features.length > 0) {
      layers.addLayer(
        L.geoJSON(satelliteFloodChange, {
          style: (feature) => {
            const cell = feature?.properties as SatelliteFloodChangeProperties;
            return {
              color: changeColor(cell.category),
              fillColor: changeColor(cell.category),
              weight: 0,
              opacity: 0.72,
              fillOpacity: 0.36
            };
          },
          onEachFeature: (feature, layer) => {
            const cell = feature.properties as SatelliteFloodChangeProperties;
            layer.bindTooltip(
              `${changeLabel(cell.category)}: ${Math.round(cell.beforeProbability * 100)}% baseline, ${Math.round(
                cell.duringProbability * 100
              )}% flood test, ${Math.round(cell.recoveryProbability * 100)}% recovery`
            );
          }
        })
      );
    }

    if (showFlood && satelliteLayerMode === "mask" && activeSatelliteMask.features.length > 0) {
      layers.addLayer(
        L.geoJSON(activeSatelliteMask, {
          style: (feature) => {
            const cell = feature?.properties as SatelliteFloodMaskProperties;
            return {
              color: cell.classification === "probable_flood" ? "#075985" : "#0e7490",
              fillColor: cell.classification === "probable_flood" ? "#0284c7" : "#67e8f9",
              weight: 0,
              opacity: 0.65,
              fillOpacity: Math.max(0.2, Math.min(0.58, cell.floodProbability * 0.56))
            };
          },
          onEachFeature: (feature, layer) => {
            const cell = feature.properties as SatelliteFloodMaskProperties;
            layer.bindTooltip(
              `${satelliteMaskLabel(cell.classification)}: ${Math.round(
                cell.floodProbability * 100
              )}% Sentinel-1 likelihood`
            );
          }
        })
      );
    }

    const roadLayer = L.geoJSON(
      roadFeatures,
      {
        style: (feature) => {
          const edge = feature?.properties as RoadEdge;
          return {
            color: edge.blocked ? "#b42318" : edge.nearFlood ? "#c76a11" : "#545454",
            weight: edge.blocked ? 4 : 3,
            opacity: edge.blocked ? 0.72 : 0.62,
            dashArray: edge.condition === "uncertain_track" ? "5 5" : undefined
          };
        },
        onEachFeature: (feature, layer) => {
          const edge = feature.properties as RoadEdge;
          layer.bindTooltip(`${edge.name}${edge.blocked ? " blocked by route decision logic" : ""}`);
        }
      }
    );
    layers.addLayer(roadLayer);

    if (rejectedRoute) {
      const rejected = L.geoJSON(routeFeatures(rejectedRoute), {
        style: {
          color: "#7b7b7b",
          weight: 5,
          opacity: 0.7,
          dashArray: "7 7"
        }
      });
      layers.addLayer(rejected);
    }

    if (currentRoute.status === "route_found") {
      layers.addLayer(
        L.geoJSON(routeFeatures(currentRoute), {
          style: {
            color: "#fffdf5",
            weight: 10,
            opacity: 0.95
          },
          interactive: false
        })
      );
      layers.addLayer(
        L.geoJSON(routeFeatures(currentRoute), {
          style: {
            color: routeColor(currentRoute.safetyClass),
            weight: 6,
            opacity: 0.92
          }
        })
      );
    }

    const base = marker(locations.base.coordinates, "base");
    base.bindTooltip(locations.base.name ?? "Ranger base");
    layers.addLayer(base);

    const incident = marker(selectedIncident.coordinates, "incident");
    incident.bindTooltip(selectedIncident.name);
    layers.addLayer(incident);

    const bounds = L.latLngBounds([
      [locations.base.coordinates[1], locations.base.coordinates[0]],
      [selectedIncident.coordinates[1], selectedIncident.coordinates[0]]
    ]);
    edges.forEach((edge) => {
      edge.geometry.coordinates.forEach(([lng, lat]) => bounds.extend([lat, lng]));
    });
    map.invalidateSize(false);
    map.fitBounds(bounds.pad(0.24), { animate: false });
  }, [
    activeWindow,
    currentRoute,
    edges,
    locations,
    rejectedRoute,
    satelliteFloodMask,
    satelliteFloodChange,
    satelliteLayerMode,
    selectedIncident,
    showFlood,
    v2Replay
  ]);

  return <div ref={containerRef} className="map-canvas" aria-label="Amboseli preliminary access route map" />;
}

function riskColor(probability: number) {
  if (probability >= 0.68) return "#b42318";
  if (probability >= 0.48) return "#c76a11";
  return "#f59e0b";
}

function changeColor(category: SatelliteFloodChangeProperties["category"]) {
  if (category === "newly_flooded") return "#0e7490";
  if (category === "persistent_water") return "#075985";
  if (category === "recovered_or_drying") return "#67e8f9";
  if (category === "residual_or_later_water") return "#0369a1";
  return "#38bdf8";
}

function changeLabel(category: SatelliteFloodChangeProperties["category"]) {
  if (category === "newly_flooded") return "Observed newly flooded cell";
  if (category === "persistent_water") return "Observed persistent water cell";
  if (category === "recovered_or_drying") return "Observed recovered or drying cell";
  if (category === "residual_or_later_water") return "Observed residual or later water cell";
  return "Observed possible change cell";
}

function satelliteMaskLabel(classification: SatelliteFloodMaskProperties["classification"]) {
  return classification === "probable_flood" ? "probable satellite flood" : "possible satellite flood";
}

function routeColor(safetyClass: RouteResult["safetyClass"]) {
  if (safetyClass === "unsafe") return "#b42318";
  if (safetyClass === "caution") return "#c76a11";
  if (safetyClass === "no_route") return "#545454";
  return "#15803d";
}

function marker(coordinates: [number, number], kind: "base" | "incident") {
  const [lng, lat] = coordinates;
  const className = kind === "base" ? "map-marker map-marker-base" : "map-marker map-marker-incident";
  return L.marker([lat, lng], {
    icon: L.divIcon({
      className,
      iconSize: [18, 18]
    })
  });
}
