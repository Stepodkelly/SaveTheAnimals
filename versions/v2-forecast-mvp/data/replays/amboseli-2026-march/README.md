# Amboseli March 2026 Replay

This is the first implemented V2 replay slice.

It uses a small hand-authored fixture of analysis cells to exercise the full V2 flow:

1. Load March 2026 as-of replay features.
2. Score cells with WettingModelV1 or PersistenceModelV1.
3. Produce mean/lower/upper/confidence risk values.
4. Score mapped road segments.
5. Compute baseline and route-safety metrics.
6. Render the V2 risk surface in the existing simple frontend.

The fixture is intentionally honest: it proves implementation mechanics, not operational skill. The next step is replacing the fixture cells with cells derived from reviewed satellite observations and issued rainfall forecasts.
