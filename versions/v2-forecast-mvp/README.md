# V2 Forecast MVP

V2 is the production-shaped, replay-first forecast MVP.

The frontend should stay visually close to V1: a prominent map, compact top metadata, comparison controls, and a simple right-side explanation panel. The product emphasis changes from observed-flood routing to future flood probability and road-risk forecasting.

## Product Contract

V2 answers:

> Given the latest reliable flood observation, historical flood behavior, recent rainfall and forecast rainfall, which areas on a 30 m analysis grid appear more likely to become or remain flooded over the next comparable observation window, and which mapped roads are lower risk for provisional access?

The MVP must prove this first through historical replay: issue a prediction at time `t`, use only data available at `t`, predict `t+h`, then compare with the later observed flood state.

## Current Implementation Status

- Sentinel-1 VV/VH rasters can be downloaded locally for multiple matched before, during and recovery comparison scenes.
- Public mask GeoJSON files are generated for all three windows from source-weighted multi-scene aggregation.
- A change layer labels newly flooded, persistent water, recovered/drying, residual/later water and possible-change cells.
- Road metrics are computed from the generated masks against the demonstration road graph.
- Generated public artifacts have SHA-256 checksums in the mask manifest; raw raster download manifests include local checksums.
- The frontend can switch between per-window masks and the all-window change layer while keeping the same simple map/side-panel layout.
- The local API has a health endpoint, GitHub Pages CORS support and a configurable frontend API base URL for a deployed backend.
- Ground-truth validation is now tracked separately from satellite/Exa candidates so unreviewed sources cannot silently become route truth.
- The Chrome/PWA path has static verification via `npm run v2:verify-pwa`; direct external Chrome automation still requires a connected browser extension.

## Primary Outputs

- Prototype flood-risk surface on a 30 m analysis grid
- Lower and upper scenario surfaces
- Forecast confidence and dominant factors
- Roads predicted to become affected
- Roads currently intersecting observed flooding
- Provisional lower-risk mapped-road route
- Historical replay comparing a past prediction with later observation
- Evaluation metrics for the replay, including road false-safe rate

## Directory Map

```text
versions/v2-forecast-mvp/
├── architecture.md
├── deployment.md
├── backend/
│   ├── api/openapi.yaml
│   └── services/README.md
├── data/
│   ├── README.md
│   ├── aoi/
│   ├── assets/
│   ├── catalog/
│   ├── derived/
│   ├── events/
│   ├── manifests/
│   ├── models/
│   ├── replays/
│   ├── reviews/
│   ├── roads/
│   ├── schemas/
│   └── tiles/
├── frontend/README.md
└── jobs/README.md
```

## Key Commands

```sh
npm run v2:probe-sentinel1-rasters
CONFIRM_LARGE_DOWNLOAD=true WINDOW_KEY=beforeFlooding SCENE_ID=S1A_IW_GRDH_1SDV_20260220T154748_20260220T154813_063304_07F31C_2469_COG npm run v2:download-sentinel1-rasters
CONFIRM_LARGE_DOWNLOAD=true WINDOW_KEY=duringFlooding SCENE_ID=S1A_IW_GRDH_1SDV_20260316T154747_20260316T154812_063654_080064_6B83_COG npm run v2:download-sentinel1-rasters
CONFIRM_LARGE_DOWNLOAD=true WINDOW_KEY=recoveryComparison SCENE_ID=S1A_IW_GRDH_1SDV_20260515T154747_20260515T154812_064529_0820BC_1569_COG npm run v2:download-sentinel1-rasters
CONFIRM_LARGE_DOWNLOAD=true WINDOW_KEY=duringFlooding LIMIT=3 npm run v2:download-sentinel1-rasters
npm run v2:derive-sentinel1-mask
npm run v2:compute-road-metrics
npm run v2:evaluate-real-mask-model
RUN_LIVE_EXA=true npm run v2:validate-ground-truth
npm run build:pages
npm run v2:verify-pwa
```

## Completion Gate

The V2 MVP is complete only when it can:

- Run at least one historical replay end to end.
- Store an as-of manifest proving no satellite observation, rainfall forecast or review input after `t` was used.
- Predict a flood-risk surface at `t+h` with mean, lower, upper, confidence and dominant-factor outputs.
- Compare the replay against at least two baselines.
- Report Brier score, calibration error, road-impact recall, false-safe road rate, unnecessary-block rate and route availability.
- Score mapped roads without fabricating off-road connectors.
- Return “no mapped route” instead of inventing one.
- Label public outputs as live, cached, simulated or replayed.
