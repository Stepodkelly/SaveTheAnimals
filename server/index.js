import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
loadEnv(path.join(rootDir, ".env"));

const app = express();
const port = Number(process.env.PORT ?? 4173);

app.use(express.json({ limit: "1mb" }));

app.post("/api/local-question", async (req, res) => {
  const request = req.body ?? {};
  const question = String(request.question ?? "").trim().slice(0, 240);
  if (!question) {
    res.status(400).json({ error: "Question is required" });
    return;
  }

  if (!process.env.EXA_API_KEY) {
    res.json(cachedLocalAnswer(question));
    return;
  }

  try {
    const exaResults = await searchExaQuestion(question, request);
    const sources = exaResults.slice(0, 5).map((result) => ({
      title: result.title ?? "Exa source",
      url: result.url,
      publishedDate: result.publishedDate
    }));
    const fallbackAnswer = localAnswerFromExa(question, sources);

    if (!process.env.GEMINI_API_KEY) {
      res.json(fallbackAnswer);
      return;
    }

    try {
      const answer = await geminiJson({
        instruction:
          "Return only JSON with keys answer and sources. Answer the ranger's local question using only the provided Exa results. You may include phone numbers or emails only for public offices, official agencies, police stations, ranger posts, county offices, NGOs, or explicitly official role contacts. Do not provide private phone numbers, home addresses, or social handles for flood-affected residents, ordinary guides, witnesses, or other private people. If a user asks for private-person contacts, redirect to official public channels. Keep the answer short and cite source URLs from the provided results.",
        payload: {
          question,
          location: request.scene?.location ?? "Amboseli, Kenya",
          observationWindows: request.observationWindows ?? request.scene?.observationWindows,
          destination: request.destination,
          exaResults
        }
      });

      res.json(normalizeLocalAnswer(answer, sources));
    } catch {
      res.json(fallbackAnswer);
    }
  } catch {
    res.json(cachedLocalAnswer(question));
  }
});

app.post("/api/intelligence", async (req, res) => {
  const request = req.body ?? {};
  const fallback = cachedIntelligence(request);
  let searchPlan = fallback.searchPlan;

  if (process.env.GEMINI_API_KEY) {
    try {
      const plan = await geminiJson({
        instruction:
          "Return only JSON. Create four search queries for checking external evidence about Amboseli road access during the flooding window. Use the provided duringFlooding start and end dates. Treat beforeFlooding and recoveryComparison only as satellite comparison context. Do not invent coordinates. Do not change the route.",
        payload: {
          location: request.scene?.location,
          acquiredAt: request.scene?.acquiredAt,
          observationWindows: request.observationWindows ?? request.scene?.observationWindows,
          route: request.route,
          knownAssets: request.knownAssets
        }
      });

      searchPlan = normalizeSearchPlan(plan, fallback.searchPlan);
    } catch {
      searchPlan = fallback.searchPlan;
    }
  }

  if (!process.env.EXA_API_KEY) {
    res.json({
      ...fallback,
      searchPlan,
      briefing: {
        ...fallback.briefing,
        summary: process.env.GEMINI_API_KEY
          ? "Gemini prepared the evidence search plan. Exa is not configured, so cached demo evidence is displayed."
          : fallback.briefing.summary
      },
      cached: true,
      sourceMode: "cached_fallback"
    });
    return;
  }

  try {
    const exaSearches = await searchExa(searchPlan.queries);
    const ruleBased = evidenceFromExa(exaSearches, request);
    let evidence = ruleBased.evidence;
    let briefing = ruleBased.briefing;

    if (process.env.GEMINI_API_KEY) {
      try {
        const extracted = await geminiJson({
          instruction:
            "Return only JSON with keys evidence and briefing. Extract dated evidence from Exa results. Publication date and event date must remain separate. Only mark geographicSpecificity exact_asset when the text names a mapped route asset. Do not invent coordinates and do not change route geometry.",
          payload: {
            knownAssets: request.knownAssets,
            route: request.route,
            destination: request.destination,
            exaSearches
          }
        });
        evidence = normalizeEvidence(extracted.evidence, evidence);
        briefing = normalizeBriefing(extracted.briefing, briefing);
      } catch {
        evidence = ruleBased.evidence;
        briefing = ruleBased.briefing;
      }
    }

    res.json({
      searchPlan,
      evidence,
      briefing,
      cached: false,
      sourceMode: "live_exa"
    });
  } catch {
    res.json(fallback);
  }
});

const distDir = path.join(rootDir, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(port, "127.0.0.1", () => {
  console.log(`RangerRoute API listening at http://127.0.0.1:${port}`);
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    process.env[key] = process.env[key] ?? value;
  }
}

async function geminiJson({ instruction, payload }) {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `${instruction}\n\nInput:\n${JSON.stringify(payload, null, 2)}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`);
  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response did not include text");
  return JSON.parse(text);
}

function normalizeSearchPlan(value, fallback) {
  if (!value || !Array.isArray(value.queries)) return fallback;
  const window = fallback.window;
  const queries = value.queries.slice(0, 4).map((query, index) => ({
    question: String(query.question ?? fallback.queries[index]?.question ?? "Evidence check"),
    query: String(query.query ?? fallback.queries[index]?.query ?? "Amboseli flood road access"),
    category: allowedCategory(query.category) ? query.category : fallback.queries[index]?.category ?? "road_access",
    dateStart: String(query.dateStart ?? fallback.queries[index]?.dateStart ?? window.start),
    dateEnd: String(query.dateEnd ?? fallback.queries[index]?.dateEnd ?? window.end),
    relevantAssetIds: Array.isArray(query.relevantAssetIds) ? query.relevantAssetIds.slice(0, 4) : []
  }));

  return { queries, window };
}

function allowedCategory(category) {
  return ["road_access", "weather", "infrastructure", "field_report", "contradictory_evidence"].includes(category);
}

async function searchExa(queries) {
  return Promise.all(
    queries.map(async (query) => {
      const response = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.EXA_API_KEY
        },
        body: JSON.stringify({
          query: query.query,
          type: "auto",
          numResults: 3,
          startPublishedDate: `${query.dateStart}T00:00:00.000Z`,
          endPublishedDate: `${query.dateEnd}T23:59:59.999Z`,
          contents: {
            highlights: true
          }
        })
      });

      if (!response.ok) throw new Error(`Exa search failed: ${response.status}`);
      const payload = await response.json();
      return {
        plan: query,
        results: Array.isArray(payload.results) ? payload.results : []
      };
    })
  );
}

async function searchExaQuestion(question, request) {
  const location = request.scene?.location ?? "Amboseli Kenya";
  const query = `${question} ${location} public official contact ranger police chief county flood access`;
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.EXA_API_KEY
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: 5,
      contents: {
        highlights: true
      }
    })
  });

  if (!response.ok) throw new Error(`Exa local question search failed: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results : [];
}

function evidenceFromExa(exaSearches, request) {
  const assets = Array.isArray(request.knownAssets) ? request.knownAssets : [];
  const evidence = [];

  for (const search of exaSearches) {
    for (const result of search.results.slice(0, 3)) {
      const text = [
        result.title,
        ...(Array.isArray(result.highlights) ? result.highlights : []),
        result.text
      ]
        .filter(Boolean)
        .join(" ");
      const matched = assets.find((asset) => text.toLowerCase().includes(String(asset.name ?? "").toLowerCase()));
      evidence.push({
        sourceTitle: result.title ?? "Exa search result",
        sourceUrl: result.url,
        publicationDate: result.publishedDate,
        inferredEventDate: search.plan.dateStart,
        claim: firstHighlight(result) ?? `Exa returned this source for: ${search.plan.question}`,
        classification: "inconclusive",
        geographicSpecificity: matched ? "exact_asset" : "unknown",
        temporalMatch: result.publishedDate ? "strong" : "unknown",
        matchedAssetId: matched?.id,
        confidence: matched ? 0.72 : 0.5
      });
    }
  }

  return {
    evidence,
    briefing: {
      summary: "Exa retrieved date-bounded sources. Gemini extraction is used when available.",
      routeAssessment:
        "The route remains deterministic. Exa evidence can explain or penalize mapped road assets only after exact-asset matching and operator approval.",
      unknowns: ["External reports may be incomplete or delayed."],
      recommendedVerification: ["Verify named road conditions with field staff before dispatch."]
    }
  };
}

function firstHighlight(result) {
  if (Array.isArray(result.highlights) && result.highlights.length > 0) {
    return result.highlights[0];
  }
  if (typeof result.text === "string" && result.text.trim()) {
    return result.text.trim().slice(0, 240);
  }
  return null;
}

function normalizeEvidence(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 12).map((item, index) => ({
    sourceTitle: String(item.sourceTitle ?? fallback[index]?.sourceTitle ?? "Evidence source"),
    sourceUrl: String(item.sourceUrl ?? fallback[index]?.sourceUrl ?? "https://example.com"),
    publicationDate: item.publicationDate ? String(item.publicationDate) : undefined,
    inferredEventDate: item.inferredEventDate ? String(item.inferredEventDate) : undefined,
    claim: String(item.claim ?? fallback[index]?.claim ?? "No extractable claim."),
    classification: allowedValue(item.classification, ["corroborates", "contradicts", "inconclusive"], "inconclusive"),
    geographicSpecificity: allowedValue(
      item.geographicSpecificity,
      ["exact_asset", "park_level", "regional", "unknown"],
      "unknown"
    ),
    temporalMatch: allowedValue(item.temporalMatch, ["strong", "weak", "mismatch", "unknown"], "unknown"),
    matchedAssetId: item.matchedAssetId ? String(item.matchedAssetId) : undefined,
    confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.5
  }));
}

function normalizeBriefing(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  return {
    summary: String(value.summary ?? fallback.summary),
    routeAssessment: String(value.routeAssessment ?? fallback.routeAssessment),
    unknowns: Array.isArray(value.unknowns) ? value.unknowns.map(String).slice(0, 4) : fallback.unknowns,
    recommendedVerification: Array.isArray(value.recommendedVerification)
      ? value.recommendedVerification.map(String).slice(0, 4)
      : fallback.recommendedVerification
  };
}

function allowedValue(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function normalizeLocalAnswer(value, fallbackSources) {
  const sources = Array.isArray(value?.sources)
    ? value.sources
        .slice(0, 5)
        .map((source, index) => ({
          title: String(source.title ?? fallbackSources[index]?.title ?? "Source"),
          url: String(source.url ?? fallbackSources[index]?.url ?? "https://example.com"),
          publishedDate: source.publishedDate ? String(source.publishedDate) : fallbackSources[index]?.publishedDate
        }))
        .filter((source) => source.url.startsWith("http"))
    : fallbackSources;

  return {
    answer: String(
      value?.answer ??
        "Review the linked public sources and verify contacts through official channels before operational use."
    ),
    sources,
    sourceMode: "live_exa",
    guardrail: localContactGuardrail()
  };
}

function localAnswerFromExa(question, sources) {
  return {
    answer:
      sources.length > 0
        ? `Live Exa found public sources for "${question}". Use the linked official or institutional pages to verify contact details before dispatch.`
        : `Live Exa did not find a usable public source for "${question}".`,
    sources,
    sourceMode: "live_exa",
    guardrail: localContactGuardrail()
  };
}

function cachedLocalAnswer(question) {
  return {
    answer: `No live local lookup was available for "${question}". Use official park, county, police, or aid-organization channels for contact confirmation.`,
    sources: [],
    sourceMode: "cached_fallback",
    guardrail: localContactGuardrail()
  };
}

function localContactGuardrail() {
  return "Private residents and unofficial personal contacts are excluded unless a source clearly publishes them as official public contact channels.";
}

function cachedIntelligence(request) {
  const selectedDestination = request.destination?.name ?? "selected incident";
  const observationWindows = request.observationWindows ?? request.scene?.observationWindows ?? defaultObservationWindows();
  const during = observationWindows.duringFlooding;

  return {
    searchPlan: {
      window: during,
      queries: [
        {
          question: "Was any named Amboseli access road reported impassable near the observation date?",
          query: "Amboseli access road impassable flood March 2026",
          category: "road_access",
          dateStart: during.start,
          dateEnd: during.end,
          relevantAssetIds: ["central_to_eastern", "eastern_to_sinet"]
        },
        {
          question: "Were park infrastructure or causeways affected around the same period?",
          query: "Amboseli causeway flooding park infrastructure March 2026",
          category: "infrastructure",
          dateStart: during.start,
          dateEnd: during.end,
          relevantAssetIds: ["north_to_causeway"]
        },
        {
          question: "Do ranger or weather reports mention field access near Amboseli?",
          query: "Amboseli ranger weather report flooding March 2026",
          category: "field_report",
          dateStart: during.start,
          dateEnd: during.end,
          relevantAssetIds: []
        },
        {
          question: "Is there contradictory evidence that access remained open?",
          query: "Amboseli roads open March 2026 flood",
          category: "contradictory_evidence",
          dateStart: during.start,
          dateEnd: during.end,
          relevantAssetIds: ["bypass_to_eastern"]
        }
      ]
    },
    evidence: [
      {
        sourceTitle: "Cached demo field note",
        sourceUrl: "https://example.com/ranger-route-demo-field-note",
        publicationDate: "2026-03-17",
        inferredEventDate: "2026-03-16",
        claim: "A named low marsh road was reported waterlogged after overnight flooding.",
        classification: "corroborates",
        geographicSpecificity: "exact_asset",
        temporalMatch: "strong",
        matchedAssetId: "central_to_eastern",
        confidence: 0.84
      },
      {
        sourceTitle: "Cached regional weather bulletin",
        sourceUrl: "https://example.com/ranger-route-demo-weather",
        publicationDate: "2026-03-18",
        inferredEventDate: "2026-03-15",
        claim: "Regional rainfall increased surface water risk across southern Kenya parks.",
        classification: "corroborates",
        geographicSpecificity: "regional",
        temporalMatch: "weak",
        confidence: 0.63
      }
    ],
    briefing: {
      summary: "Cached demonstration evidence is shown because Exa is not configured.",
      routeAssessment: `The preliminary access route to ${selectedDestination} should be treated as a planning aid only. Flooded graph edges remain excluded, and vague regional reports are not attached to specific road assets.`,
      unknowns: [
        "Current field passability is unknown.",
        "Small bridges, gates and culverts are not represented in the demo road graph."
      ],
      recommendedVerification: [
        "Call the nearest ranger post before dispatch.",
        "Confirm whether the selected destination is still accessible by vehicle."
      ]
    },
    cached: true,
    sourceMode: "cached_fallback"
  };
}

function defaultObservationWindows() {
  return {
    beforeFlooding: {
      label: "Before flooding",
      start: "2026-01-15",
      end: "2026-02-20"
    },
    duringFlooding: {
      label: "During flooding",
      start: "2026-03-09",
      end: "2026-03-20"
    },
    recoveryComparison: {
      label: "Recovery comparison",
      start: "2026-05-07",
      end: "2026-05-15"
    }
  };
}
