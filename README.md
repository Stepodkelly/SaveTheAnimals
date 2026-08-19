# #save_the_animals

Evidence-aware flood access planning for Amboseli.

This prototype shows a preliminary access route from a ranger base to a selected incident location. It combines a small deterministic road graph, satellite-derived flood masks, Exa-powered local evidence retrieval, and Gemini/OpenAI-assisted route explanations.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Environment

Create a local `.env` file:

```env
GEMINI_API_KEY=your_gemini_key
EXA_API_KEY=your_exa_key
OPENAI_API_KEY=your_openai_key_optional
PORT=4173
```

The `.env` file is intentionally gitignored.

## Safety Note

The app must say “preliminary access route,” not “safe rescue route.” Satellite and web observations may be delayed or incomplete, and field verification is required.

## Versions

The repository has a version filing structure:

- `versions/v1-current-route-demo/` documents the current implemented route demo.
- `versions/v2-forecast-mvp/` contains the production-shaped forecast MVP architecture, data jobs, generated reports, replay evaluation, Sentinel mask workflow and deployment notes.

The root app is now the active V2-style public frontend/server while preserving the V1 filing reference.
