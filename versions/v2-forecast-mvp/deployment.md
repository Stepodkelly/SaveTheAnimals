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

## Live UX Status

The static judge URL can display all generated Sentinel masks, road-risk scores, route safety classes and strict-clear routing without secrets. The Run buttons need the deployed backend URL in `VITE_API_BASE_URL` and valid server-side `EXA_API_KEY` plus either `GEMINI_API_KEY` or `OPENAI_API_KEY`.

Current frontend builds are deploy-ready for GitHub Pages. Backend deployment still requires a public Node host such as Render using `render.yaml`, because GitHub Pages cannot store or execute secret-backed Exa/OpenAI calls.

## What Blocks Live Backend Deployment

Nothing in the codebase blocks it: `server/index.js`, `Dockerfile`, `render.yaml`, CORS and `/api/health` are present. The remaining blocker is external infrastructure:

- a public Node backend host connected to this repository;
- production environment variables for `EXA_API_KEY` and at least one LLM key;
- the deployed backend origin added to the Pages build through `VITE_API_BASE_URL`;
- a final public health check showing `exaConfigured` and `llmConfigured` as true.

After those are set, rebuild with `VITE_API_BASE_URL=https://<deployed-api-origin> npm run build:pages`, push `docs/`, and the public Run buttons will call the live backend.
