# Evaluation Report

Status: implemented on the March 2026 replay fixture.

The current report proves the V2 code path: feature cells are scored by WettingModelV1 or PersistenceModelV1, roads are scored from intersecting risk cells, and replay metrics are computed. It is not yet a validated operational model because the fixture still needs to be replaced by downloaded/reviewed satellite and rainfall assets.

This report is not complete until at least one historical replay has been run with an as-of manifest.

## Evaluation Modes

- `hydrology_fit_eval`: can use observed rainfall to test whether the feature design captures flood response.
- `operational_replay_eval`: can only use observations, rainfall forecasts, reviews and derived features available at `asOf`.

## Split Rule

Use leave-one-event-out evaluation. Do not split by random pixels. Neighboring cells from the same event are correlated and cannot be treated as independent test examples.

## Required Baselines

- Current-flood persistence baseline
- Historical flood-frequency baseline
- Rainfall-threshold baseline

## Required V2 Metrics

- Brier score
- Probability calibration error
- Precision and recall by class
- Intersection over Union
- Flood-boundary distance
- Road-impact recall
- False-safe road rate
- Unnecessary-block rate
- Route availability
- Additional route distance

## Primary Pass/Fail Metrics

- `false_safe_road_rate`: must be reported for every replay.
- `road_impact_recall`: must be reported for every replay.
- `brier_score`: must beat at least one non-trivial baseline before model claims are made.
- `calibration_error`: must be reported separately from classification metrics.

## Required Replay Table

| replay_id | as_of | valid_at | held_out_event_id | model_version | baseline | brier_score | calibration_error | road_impact_recall | false_safe_road_rate | route_availability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| amboseli-2026-march | 2026-03-10T00:00:00Z | 2026-03-16T00:00:00Z | amboseli-2026-long-rains | wetting-v1 + persistence-v1 | current-flood persistence | 0.060 | 0.107 | 0.833 | 0.167 | 1.000 |
| amboseli-2026-march | 2026-03-10T00:00:00Z | 2026-03-16T00:00:00Z | amboseli-2026-long-rains | baseline | current-flood persistence | 0.192 | n/a | n/a | n/a | n/a |
| amboseli-2026-march | 2026-03-10T00:00:00Z | 2026-03-16T00:00:00Z | amboseli-2026-long-rains | baseline | historical frequency | 0.088 | n/a | n/a | n/a | n/a |
| amboseli-2026-march | 2026-03-10T00:00:00Z | 2026-03-16T00:00:00Z | amboseli-2026-long-rains | baseline | rainfall threshold | 0.104 | n/a | n/a | n/a | n/a |

## Leakage Audit

Each replay must prove:

- No satellite observation after `asOf` was used.
- No rainfall forecast issued after `asOf` was used.
- Historical features were rebuilt without the held-out event.
- Review overrides created after full-event inspection were not used in the as-of forecast.
- Spatial post-processing did not use the held-out event's final maximum extent.

## Fixture Result

The implemented fixture currently beats all three simple baselines on Brier score:

- V2 split logistic replay: `0.060`
- Current-flood persistence baseline: `0.192`
- Historical-frequency baseline: `0.088`
- Rainfall-threshold baseline: `0.104`

Road-risk result:

- Road-impact recall: `0.833`
- False-safe road rate: `0.167`
- Unnecessary-block rate: `0.000`
- Route availability: `1.000`

Next hardening step: replace the hand-authored replay cells with derived cells from reviewed Sentinel/CEMS/HYDRAFloods observation assets and issued rainfall forecasts.
