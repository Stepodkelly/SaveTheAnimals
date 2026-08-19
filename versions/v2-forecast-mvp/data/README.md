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

## Sentinel-1 Pull Status

V2 can currently pull real Sentinel-1 scene metadata through Copernicus Data Space STAC and public quicklook thumbnails for the before/during/recovery windows.

Full VV/VH raster downloads are scripted but require Copernicus Data Space OIDC credentials. The raster access report records the current state and should be regenerated after setting `CDSE_ACCESS_TOKEN`, `CDSE_REFRESH_TOKEN` or `CDSE_USERNAME`/`CDSE_PASSWORD`.
