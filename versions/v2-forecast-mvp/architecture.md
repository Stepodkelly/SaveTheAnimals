# V2 Architecture

## System Shape

```text
Reviewed historical flood transitions
+ recent observed flood state
+ recent and forecast rainfall
+ empirical residence/connectivity
-> prototype cell-level flood-risk surfaces
-> future road risk
-> provisional lower-risk route
```

## Pipelines

### Historical Pipeline

1. Catalogue Sentinel-1, Sentinel-2, rainfall and flood-monitoring sources.
2. Discover annual candidate events from 2015 onward.
3. Build a human-editable event ledger.
4. Extract arrival, residence and recession features.
5. Build transition records with source/target observation IDs and confidence weights.
6. Train small WettingModelV1 and PersistenceModelV1 artifacts only after the event-count feasibility gate passes.
7. Evaluate by leaving out whole flood events, never random pixels.

### Forecast Pipeline

1. Load latest Sentinel-1 or CEMS GFM flood state.
2. Load recent IMERG rainfall and ensemble rainfall forecast.
3. Run WettingModelV1 and PersistenceModelV1 inference over 30 m cells.
4. Apply spatial coherence processing.
5. Evaluate road risk for mapped roads.
6. Generate a provisional lower-risk route.
7. Explain the route with provenance and optional Exa plus Gemini/OpenAI evidence.

### Historical Replay Pipeline

1. Choose `asOf` and `validAt`.
2. Build an as-of manifest listing every allowed input asset.
3. Fail the replay if any observation, forecast, review override or derived feature was created from information after `asOf`.
4. Generate the flood-risk surface and road-risk output.
5. Reveal the later observation at `validAt`.
6. Score model and road outputs against the observation and baselines.

## Geographic Structure

- Display AOI: Amboseli National Park boundary for map framing and route display.
- Analysis AOI: park plus hydrologically contributing area for rainfall aggregation, runoff and wetland connectivity.

## Grid

Use a 30 m grid with durable cell IDs:

```text
amboseli-30m-v1:{row}:{column}
```

Changing projection, origin or resolution creates a new grid version.

The 30 m grid is a durable indexing and reporting choice. It is not a claim that the system knows flood truth to exactly 30 m in every wetland edge, mixed pixel, vegetation or radar-shadow condition.

## Models

Use two transparent models first:

- `WettingModelV1`: probability that a cell not currently observed flooded becomes observed flooded by `validAt`.
- `PersistenceModelV1`: probability that a currently observed flooded cell remains observed flooded by `validAt`.

Both models are logistic-regression risk scorers for the MVP. They must store feature schema version, coefficient values, calibration method, training events, excluded events, target policy, sample-weight policy and out-of-distribution rules.

If fewer than five independent reviewed flood events are available, keep the MVP in replay/scenario mode and do not claim trained operational forecasting.

## Evaluation Rule

Evaluation uses whole-event holdout only. Historical flood-frequency, arrival, residence and recession features must be rebuilt inside each fold without the held-out event.

Primary metrics:

- Brier score
- Calibration error
- Road-impact recall
- False-safe road rate
- Unnecessary-block rate
- Route availability
- Tuned decision threshold, with probability quality reported separately from block/no-block quality

Baselines:

- Current-flood persistence
- Historical flood-frequency
- Rainfall-threshold risk

## Road Rule

Observed open water blocks a road segment only when the overlap exceeds the configured conservative policy threshold. Forecast probability increases cost or blocks the segment depending on the selected safety policy. Roads must come from OpenStreetMap or manually reviewed GeoJSON; the system must not fabricate off-road connectors.

Routes are classified as:

- `safe`: no mapped flood-mask contact on the selected route.
- `caution`: no direct possible/probable flood-cell crossing, but nearby flood cells, uncertain track, or unreviewed evidence affects the path.
- `unsafe`: the best available path directly crosses possible or probable flood cells.
- `no_route`: no mapped route remains after the selected safety policy is applied.

Best-available routing may return an `unsafe` route when no cleaner path exists. Strict-clear routing rejects blocked roads and direct possible/probable flood-cell crossings. Route language must stay conservative: provisional lower-risk mapped-road route, field verification required, never “safe route” as an operational guarantee.

## Sentinel Mask Quality Rule

The V2 mask pipeline processes several Sentinel scenes per observation window and aggregates them by source-weighted probability. Local full VV/VH rasters receive full weight; Copernicus quicklook fallback receives lower weight. Each mask manifest records the number of raw and quicklook scenes plus a quality tier. Set `REQUIRE_RAW_SCENES=true` to fail derivation unless every selected scene has local VV/VH rasters.

## Evidence Rule

Exa plus Gemini/OpenAI evidence can explain uncertainty and confidence. Unverified extracted claims cannot automatically close a road.

Evidence claims must be labeled `unverified`, `official`, `operator_reviewed` or `field_verified`. Public/private contact information must not be surfaced unless it is already official public contact information.
