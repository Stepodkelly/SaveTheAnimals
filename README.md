# #save_the_animals

Evidence-aware flood access planning for Amboseli.

This prototype shows a preliminary access route from a ranger base to a selected incident location. It combines a small deterministic road graph, satellite-derived flood polygons, Exa-powered local evidence retrieval, and Gemini-assisted route explanations.

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
PORT=4173
```

The `.env` file is intentionally gitignored.

## Safety Note

The app must say “preliminary access route,” not “safe rescue route.” Satellite and web observations may be delayed or incomplete, and field verification is required.

## Versions

The repository has a version filing structure:

- `versions/v1-current-route-demo/` documents the current implemented route demo.
- `versions/v2-forecast-mvp/` contains the production-shaped forecast MVP architecture scaffold.

The root app remains the active V1 frontend/server while V2 is built separately.
