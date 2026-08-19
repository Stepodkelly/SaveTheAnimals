# V2 deployment

The public GitHub Pages app is static. Live Exa/Gemini calls require deploying `server/index.js` with secret environment variables.

## Backend

Render can use `render.yaml` directly. Required secrets:

- `EXA_API_KEY`
- `GEMINI_API_KEY`

Important environment values:

- `HOST=0.0.0.0`
- `ALLOWED_ORIGINS=https://stepodkelly.github.io`

The health check is `/api/health`.

## Frontend

Build GitHub Pages with the deployed API origin:

```sh
VITE_API_BASE_URL=https://your-api-host.example npm run build:pages
```

When `VITE_API_BASE_URL` is empty, the frontend falls back to static demo mode for public Pages.
