# V2 Forecast MVP

V2 is the production-shaped forecast MVP.

The frontend should stay visually close to V1: a prominent map, compact top metadata, comparison controls, and a simple right-side explanation panel. The product emphasis changes from observed-flood routing to future flood probability and road-risk forecasting.

## Product Contract

V2 answers:

> Given the latest reliable flood observation, historical flood behavior, recent rainfall and forecast rainfall, which 30 m areas of Amboseli are likely to become or remain flooded over the next 3-7 days, and which mapped roads are lower risk for provisional access?

## Primary Outputs

- Future flood probability for every 30 m analysis cell
- Lower and upper rainfall scenarios
- Forecast confidence and dominant factors
- Roads predicted to become affected
- Roads currently intersecting observed flooding
- Provisional lower-risk route
- Historical replay comparing a past prediction with later observation

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
│   ├── catalog/
│   ├── events/
│   ├── derived/
│   ├── reviews/
│   └── models/
├── frontend/README.md
└── jobs/README.md
```

## Completion Gate

The V2 MVP is complete only when it can issue a forecast at time `t`, avoid using satellite observations after `t`, predict a future flood surface at `t+h`, evaluate future road risk, and return “no mapped route” instead of inventing one.
