# Sentinel-1 Asset Manifests

Authenticated raster downloads write manifest files here.

Each manifest records:

- source scene ID
- VV/VH band
- local URI
- expected size
- observed/published timestamps
- source URL
- grid version
- parent job ID

Large raster files are not committed to git.
