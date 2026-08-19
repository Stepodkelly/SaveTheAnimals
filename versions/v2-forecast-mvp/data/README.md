# V2 Data Filing

Large machine-generated data and human review files must remain separate.

## Principle

```text
Machine-generated data
+ human override files
= reviewed dataset
```

## Layout

```text
data/
├── aoi/
├── assets/
├── catalog/
├── events/
├── derived/
├── manifests/
├── models/
├── replays/
├── reviews/
├── roads/
├── schemas/
└── tiles/
```

## Review Rule

Edit override files, not generated catalogues.

## Asset Rule

Large rasters, Parquet tables, model artifacts, quicklooks and tiles are represented by immutable asset manifests. A generated artifact is not considered part of V2 unless it has a URI, checksum, algorithm version, grid version, source inputs and parent job ID.

## Replay Rule

Replays live under `data/replays/`. Each replay contains an as-of manifest and an evaluation report. The replay manifest is the source of truth for what the system was allowed to know at prediction time.
