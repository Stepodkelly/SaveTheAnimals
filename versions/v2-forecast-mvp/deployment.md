# V2 deployment

The public GitHub Pages app is static. Live Exa plus Gemini/OpenAI calls require deploying `server/index.js` with secret environment variables.

## Backend

Render can use `render.yaml` directly. Required secrets:

- `EXA_API_KEY`
- `GEMINI_API_KEY` or `OPENAI_API_KEY`

Important environment values:

- `HOST=0.0.0.0`
- `ALLOWED_ORIGINS=https://stepodkelly.github.io`
- `GEMINI_MODEL=gemini-2.5-flash` when using Gemini
- `OPENAI_MODEL=gpt-5-mini` when using OpenAI

The health check is `/api/health`; it reports whether Exa, Gemini and OpenAI are configured.

## Frontend

Build GitHub Pages with the deployed API origin:

```sh
VITE_API_BASE_URL=https://your-api-host.example npm run build:pages
```

When `VITE_API_BASE_URL` is empty, the frontend falls back to static demo mode for public Pages.
