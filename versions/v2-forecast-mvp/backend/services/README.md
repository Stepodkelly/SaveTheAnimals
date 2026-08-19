# V2 Backend Services

The production-shaped MVP separates heavy processing from ordinary HTTP requests.

## MVP Modules

Start with six implementation modules. These are intentionally smaller than the production service map.

- `Catalog`: scenes, rainfall records and source metadata.
- `Observations`: flood masks, confidence, unknown masks and derived observation assets.
- `Events`: event ledger, review overrides and annual summaries.
- `Forecasts`: feature assembly, model inference, replay and forecast-run outputs.
- `Roads`: OSM graph, segment risk and routing.
- `Evidence`: Exa/Gemini searches, claims, citations and verification state.

## Production Service Targets

- `CatalogService`
- `AssetService`
- `EventDiscoveryService`
- `ReviewService`
- `ObservationService`
- `HistoricalHydrologyService`
- `TrainingService`
- `ForecastService`
- `RoadRiskService`
- `RouteService`
- `EvidenceService`

## Rule

HTTP handlers create, read or summarize jobs. Cataloguing, raster processing, model training, forecast generation and road-risk evaluation run in background workers.

Every heavy output is immutable. Re-running a job either reuses an artifact by manifest hash or writes a new version.
