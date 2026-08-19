# V2 Architecture

## System Shape

```text
Reviewed historical flood transitions
+ recent observed flood state
+ recent and forecast rainfall
+ empirical residence/connectivity
-> future cell-level flood probabilities
-> future road risk
-> provisional lower-risk route
```

## Pipelines

### Historical Pipeline

1. Catalogue Sentinel-1, Sentinel-2, rainfall and flood-monitoring sources.
2. Discover annual candidate events from 2015 onward.
3. Build a human-editable event ledger.
4. Extract arrival, residence and recession features.
5. Train small WettingModelV1 and PersistenceModelV1 artifacts.

### Forecast Pipeline

1. Load latest Sentinel-1 or CEMS GFM flood state.
2. Load recent IMERG rainfall and ensemble rainfall forecast.
3. Run WettingModelV1 and PersistenceModelV1 inference over 30 m cells.
4. Apply spatial coherence processing.
5. Evaluate road risk for mapped roads.
6. Generate a provisional lower-risk route.
7. Explain the route with provenance and optional Exa/Gemini evidence.

## Geographic Structure

- Display AOI: Amboseli National Park boundary for map framing and route display.
- Analysis AOI: park plus hydrologically contributing area for rainfall aggregation, runoff and wetland connectivity.

## Grid

Use a 30 m grid with durable cell IDs:

```text
amboseli-30m-v1:{row}:{column}
```

Changing projection, origin or resolution creates a new grid version.

## Road Rule

Observed open water blocks a road edge. Forecast probability increases cost or blocks the edge depending on the selected safety policy. Roads must come from OpenStreetMap or manually reviewed GeoJSON; the system must not fabricate off-road connectors.

## Evidence Rule

Exa/Gemini evidence can explain uncertainty and confidence. Unverified extracted claims cannot automatically close a road.
