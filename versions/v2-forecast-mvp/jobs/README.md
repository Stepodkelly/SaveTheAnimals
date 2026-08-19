# V2 Durable Jobs

Every job stores:

- Idempotency key
- Input manifest hash
- Algorithm version
- Code version or commit
- Status
- Attempts
- Parent job IDs
- Structured error
- Output asset IDs
- Start and completion timestamps

## Job Types

```text
CATALOG_YEAR
PROCESS_SCENE
DISCOVER_EVENTS
BUILD_EVENT
BUILD_HISTORY
TRAIN_MODELS
GENERATE_FORECAST
EVALUATE_ROADS
SEARCH_EVIDENCE
BUILD_ROAD_GRAPH
GENERATE_TILES
RUN_REPLAY_EVALUATION
IMPORT_REVIEW_OVERRIDES
VALIDATE_DATASET
PULL_SENTINEL1_STAC
DOWNLOAD_SENTINEL1_QUICKLOOKS
PROBE_SENTINEL1_RASTERS
DOWNLOAD_SENTINEL1_RASTERS
```

## Idempotency Examples

```text
catalog-year:amboseli:2024:catalog-v1
build-event:amboseli-2024-long-rains:review-v1:algorithm-v1
generate-forecast:amboseli-analysis-v1:2026-03-10T00:00:00Z:2026-03-16T00:00:00Z
run-replay-evaluation:amboseli-2026-march:2026-03-10T00:00:00Z:2026-03-16T00:00:00Z
```

## As-Of Rule

Replay and forecast jobs fail if any input asset is newer than the job `asOf` cutoff, unless the asset is explicitly marked as static geography such as AOI, DEM, grid or reviewed road geometry.
