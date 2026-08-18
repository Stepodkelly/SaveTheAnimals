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
