# Sentinel-1 Raw Raster Store

This directory is reserved for authenticated Sentinel-1 VV/VH COG or GRD raster downloads.

The repository intentionally ignores large `.tif` and `.zip` files here. Download manifests are stored under `data/assets/sentinel1/` so large local files can be reproduced without committing them.

Current access state:

- STAC metadata: implemented.
- Quicklook downloads: implemented.
- Full VV/VH raster downloader: implemented.
- Full VV/VH raster access: blocked until Copernicus Data Space OIDC credentials are provided.

Run:

```text
npm run v2:pull-sentinel1
npm run v2:probe-sentinel1-rasters
CONFIRM_LARGE_DOWNLOAD=true npm run v2:download-sentinel1-rasters
```
