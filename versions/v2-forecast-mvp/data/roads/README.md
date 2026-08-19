# Roads

V2 routes only over mapped roads from OpenStreetMap or manually reviewed GeoJSON.

Road rules:

- Do not fabricate off-road connectors.
- Split long road edges into short risk-scored segments.
- Store OSM IDs, source timestamp, surface/track metadata when available, and review status.
- Observed open water can hard-block a segment only under the selected safety policy.
- Forecast risk is graded and visible.
- Unknown cells do not become confidently safe road segments.
- Route responses must say field verification is required.
