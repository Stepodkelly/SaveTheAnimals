# V2 Forecast MVP

V2 is the production-shaped, replay-first forecast MVP.

The frontend should stay visually close to V1: a prominent map, compact top metadata, comparison controls, and a simple right-side explanation panel. The product emphasis changes from observed-flood routing to future flood probability and road-risk forecasting.

## Product Contract

V2 answers:

> Given the latest reliable flood observation, historical flood behavior, recent rainfall and forecast rainfall, which areas on a 30 m analysis grid appear more likely to become or remain flooded over the next comparable observation window, and which mapped roads are lower risk for provisional access?

The MVP must prove this first through historical replay: issue a prediction at time `t`, use only data available at `t`, predict `t+h`, then compare with the later observed flood state.

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
