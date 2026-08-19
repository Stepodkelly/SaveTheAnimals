# V2 Reports

Machine-readable reports for external-data readiness checks.

- `sentinel1_raster_access_report.json`: proves whether VV/VH raster URLs are readable with the current Copernicus credential environment.
- `geospatial_tooling_report.json`: proves whether the current machine can derive flood masks from downloaded rasters.
- `sentinel1_road_metrics.json`: summarizes direct and nearby flood-mask touches for every road segment.
- `v2_real_mask_evaluation.json`: compares the replay regression against generated Sentinel masks and a broader mask-grid diagnostic.
- `ground_truth_validation.json`: separates reviewer-approved road truth from Exa/public candidate sources.
