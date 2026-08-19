# SaveTheAnimals Versions

This repository now separates the current working demo from the production-shaped forecast MVP.

## Version Index

| Version | Folder | Status | Purpose |
| --- | --- | --- | --- |
| V1 | `versions/v1-current-route-demo/` | Implemented in the repository root | Evidence-aware preliminary access route from observed flood polygons and a small road graph |
| V2 | `versions/v2-forecast-mvp/` | Architecture and filesystem scaffold | Forecast 30 m flood probability over 3-7 days, evaluate road risk and route over mapped roads |

## Active App

The runnable frontend and local server remain at the repository root:

```text
src/
server/
public/data/amboseli/
```

This keeps the judge-facing frontend stable while V2 is developed in a separate filing area.
