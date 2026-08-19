# V2 Frontend Notes

Keep the V1 visual pattern:

- Prominent map
- Compact top metadata strip
- Right-side chart and written explanation panel
- Plain, operational styling
- No marketing landing page

## Default Forecast Mode

Show:

- Forecast issued time
- Forecast valid time
- Latest observation used
- Expected flood probability surface
- Lower and upper scenarios
- Roads predicted to become affected
- Proposed provisional lower-risk route
- Route safety class: safe, caution, unsafe or no-route
- Best mode and strict-clear mode
- Model confidence
- Dominant explanatory factors

## Historical Replay Mode

```text
Choose historical issuance date
-> generate prediction without later data
-> reveal later Sentinel-1 observation
-> compare prediction versus observation
```

## Comparison Mode

Keep the current before/during/recovery toggle style, but extend it to:

- Before
- During
- Recovery
- Arrival
- Residence
- Recession

## Route Display Rule

The map must not imply that a route is operationally safe when it crosses flood-risk cells. The selected route is color-coded by route safety class and the side panel prints the route flood check:

- `safe`: avoids mapped flood cells.
- `caution`: direct crossings avoided, but nearby flood cells or uncertain roads remain.
- `unsafe`: crosses possible or probable flood cells.
- `no_route`: strict-clear routing found no mapped route.
