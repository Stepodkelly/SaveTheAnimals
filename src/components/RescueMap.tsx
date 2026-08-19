import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, LineString } from "geojson";
import type {
  FloodCollection,
  IncidentLocation,
  LocationsData,
  ObservationWindowKey,
  RoadEdge,
  RouteResult,
  V2ReplayEvaluation,
  V2ScoredCellProperties
} from "../types";
import { routeFeatures } from "../lib/routing";

type RescueMapProps = {
  locations: LocationsData;
  floods: FloodCollection;
  edges: RoadEdge[];
  currentRoute: RouteResult;
  rejectedRoute: RouteResult | null;
  selectedIncident: IncidentLocation;
  showFlood: boolean;
  activeWindow: ObservationWindowKey;
  v2Replay: V2ReplayEvaluation | null;
};

export function RescueMap({
  locations,
  floods,
  edges,
  currentRoute,
  rejectedRoute,
  selectedIncident,
  showFlood,
  activeWindow,
  v2Replay
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
              `${cell.label}: ${Math.round(cell.probability * 100)}% ${cell.model.replace("-v1", "")} risk`
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
          layer.bindTooltip(`${edge.name}${edge.blocked ? " blocked by traced flood" : ""}`);
        }
      }
    );
    layers.addLayer(roadLayer);

    if (showFlood) {
      layers.addLayer(
        L.geoJSON(floods, {
          style: floodStyle(activeWindow),
          onEachFeature: (feature, layer) => {
            const confidence = feature.properties?.confidence
              ? ` (${Math.round(feature.properties.confidence * 100)}% confidence)`
              : "";
            layer.bindTooltip(`${floodLabel(activeWindow)}: ${feature.properties?.label ?? "flood extent"}${confidence}`);
          }
        })
      );
    }

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
            color: "#15803d",
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
    map.fitBounds(bounds.pad(0.24), { animate: false });
  }, [activeWindow, currentRoute, edges, floods, locations, rejectedRoute, selectedIncident, showFlood, v2Replay]);

  return <div ref={containerRef} className="map-canvas" aria-label="Amboseli preliminary access route map" />;
}

function floodStyle(activeWindow: ObservationWindowKey) {
  if (activeWindow === "recoveryComparison") {
    return {
      color: "#38bdf8",
      fillColor: "#075985",
      weight: 1,
      fillOpacity: 0.2,
      dashArray: "5 5"
    };
  }

  return {
    color: "#12b8d7",
    fillColor: "#083b68",
    weight: 2,
    fillOpacity: 0.46
  };
}

function floodLabel(activeWindow: ObservationWindowKey) {
  if (activeWindow === "beforeFlooding") return "Before-flood comparison";
  if (activeWindow === "recoveryComparison") return "Recovery comparison residual";
  return "During-flood satellite extent";
}

function riskColor(probability: number) {
  if (probability >= 0.68) return "#b42318";
  if (probability >= 0.48) return "#c76a11";
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
