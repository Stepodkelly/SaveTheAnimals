# V2 Backend Services

The production-shaped MVP separates heavy processing from ordinary HTTP requests.

## Services

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
