# Manifests

Manifests are the V2 guardrail against accidental overclaiming.

Every replay, forecast, model training run and evaluation must list the exact input assets it was allowed to use, the as-of cutoff, the grid version, the model versions and the excluded events. Jobs fail when a non-static input is newer than the manifest `asOf`.

Static geography inputs such as AOIs, grid definitions, DEM derivatives and reviewed road geometry may be older than or equal to the job and are marked with `role: static_geography`.
