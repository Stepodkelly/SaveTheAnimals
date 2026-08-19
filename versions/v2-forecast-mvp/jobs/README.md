# V2 Durable Jobs

Every job stores:

- Idempotency key
- Input manifest
- Algorithm version
- Status
- Attempts
- Error
- Output assets
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
```

## Idempotency Examples

```text
catalog-year:amboseli:2024:catalog-v1
build-event:amboseli-2024-long-rains:review-v1:algorithm-v1
generate-forecast:amboseli-analysis-v1:2026-03-10T00:00:00Z:2026-03-16T00:00:00Z
```
