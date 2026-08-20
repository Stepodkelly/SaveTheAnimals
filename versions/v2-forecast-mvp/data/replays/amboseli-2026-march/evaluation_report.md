# Amboseli March 2026 Replay Evaluation

Status: implemented as a deterministic replay fixture.

## Replay Window

- Pre-event baseline: January 15-February 20, 2026
- Flood test window: March 9-20, 2026
- Recovery observation: May 7-15, 2026
- MVP issue time: March 10, 2026 00:00 UTC
- MVP validation time: March 16, 2026 00:00 UTC

## Required Outputs

| output | status |
| --- | --- |
| as-of manifest | implemented |
| source observations | fixture cells |
| rainfall inputs | fixture features |
| risk surface | implemented |
| lower/upper surfaces | implemented |
| road-risk segments | implemented |
| route result | implemented in frontend |
| later observation | fixture labels |
| baseline comparison | implemented |

## Metrics

| metric | value |
| --- | --- |
| Brier score | 0.060 |
| Calibration error | 0.107 |
| Road-impact recall | 0.833 |
| False-safe road rate | 0.167 |
| Unnecessary-block rate | 0.000 |
| Route availability | 1.000 |

## Baselines

| baseline | Brier score |
| --- | --- |
| Current flood persists | 0.192 |
| Historical frequency | 0.088 |
| Rainfall threshold | 0.104 |

## Implementation Notes

The replay fixture is stored in `public/data/amboseli/v2-replay-cells.geojson` so the static frontend can compute and display the V2 surface without a secret-backed backend. The same logic is exposed by the local API at `/api/v2/replays/amboseli-2026-march/evaluation`.
