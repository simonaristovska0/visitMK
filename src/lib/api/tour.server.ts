export interface LandmarkSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
}

// ── Theme detection ───────────────────────────────────────────────────────────

interface SearchQuery { query: string; categories?: string[] }

function detectThemes(wish: string): SearchQuery[] {
  const w = wish.toLowerCase();
  const searches: SearchQuery[] = [];

  if (/\b(eat|food|lunch|dinner|restaurant|cuisine|italian|pizza|macedonian|sushi|burger|tavern|traditional)\b/.test(w))
    searches.push({ query: wish, categories: ["food"] });

  if (/\b(coffee|cafe|cappuccino|espresso|latte|drink|tea|dessert|cake|pastry)\b/.test(w))
    searches.push({ query: "coffee cafe", categories: ["cafe"] });

  if (/\b(park|nature|garden|outdoor|hike|walk|lake|river|mountain|fresh air)\b/.test(w))
    searches.push({ query: "park garden outdoor", categories: ["outdoors"] });

  if (/\b(shop|shopping|market|bazaar|buy|souvenir|mall)\b/.test(w))
    searches.push({ query: "bazaar market shopping", categories: ["shopping"] });

  if (/\b(museum|history|culture|art|gallery|exhibition|ottoman|byzantine|roman|archaeological)\b/.test(w))
    searches.push({ query: wish, categories: ["culture", "landmark"] });

  // Always include general city landmarks
  searches.push({ query: "city landmark historic centre", categories: ["landmark", "culture"] });

  return searches;
}

function extractStopCount(wish: string): number {
  const m = wish.match(/\b(\d+)\s*(stop|place|spot|location|thing|site)/i);
  if (m) return Math.min(10, Math.max(2, parseInt(m[1])));
  if (/\bquick\b|\bshort\b|\bfast\b/i.test(wish)) return 3;
  if (/\bfull.?day\b|\bwhole.?day\b|\ball.?day\b/i.test(wish)) return 7;
  if (/\bhalf.?day\b/i.test(wish)) return 4;
  return 5;
}

// ── Local search ──────────────────────────────────────────────────────────────

function searchLandmarks(
  query: string,
  categories: string[] | undefined,
  all: LandmarkSummary[],
  limit = 8,
): LandmarkSummary[] {
  const q = query.toLowerCase();
  return all
    .filter((l) => !categories?.length || categories.includes(l.category))
    .map((l) => {
      let score = 0;
      if (q) {
        if (l.name.toLowerCase().includes(q)) score += 4;
        if (l.category.toLowerCase().includes(q)) score += 3;
        if (l.description.toLowerCase().includes(q)) score += 1;
      } else {
        score = 1;
      }
      return { l, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ l }) => l);
}

// ── Groq call ─────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

async function callGroq(
  systemText: string,
  userText: string,
  tools: unknown,
  apiKey: string,
): Promise<ToolCall[]> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "select_tour_stops" } },
      max_tokens: 512,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq error ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { tool_calls?: ToolCall[] } }>;
  };
  return json.choices?.[0]?.message?.tool_calls ?? [];
}

// ── Public export ─────────────────────────────────────────────────────────────

export async function planTourWithAI(
  wish: string,
  landmarks: LandmarkSummary[],
  apiKey: string,
): Promise<string[]> {
  // Map to short handles so the model can't garble long IDs
  const handleToId = new Map<string, string>();
  const landmarksWithHandles = landmarks.map((l, i) => {
    const handle = `p${i + 1}`;
    handleToId.set(handle, l.id);
    return { ...l, id: handle };
  });

  const stopCount = extractStopCount(wish);

  // Build candidate pool: server-side theme detection + targeted searches
  const themes = detectThemes(wish);
  const seen = new Set<string>();
  const candidates: LandmarkSummary[] = [];

  for (const theme of themes) {
    const results = searchLandmarks(theme.query, theme.categories, landmarksWithHandles);
    for (const r of results) {
      if (!seen.has(r.id)) { seen.add(r.id); candidates.push(r); }
    }
  }

  console.log(`[planTour] wish="${wish}" stopCount=${stopCount} candidates=${candidates.length} themes=${themes.length}`);

  const candidateList = candidates
    .map((c) => `- id:${c.id} name:"${c.name}" category:${c.category} lat:${c.lat.toFixed(4)} lng:${c.lng.toFixed(4)}\n  info: ${c.description.slice(0, 100)}`)
    .join("\n");

  const systemText =
    "You are a tour planner for Skopje, North Macedonia. " +
    "Pick the best stops from the candidate list that match the visitor's wish. " +
    `Select exactly ${stopCount} stops. ` +
    "Prefer thematic fit first, then geographic clustering (nearby lat/lng). " +
    "Use only IDs from the list — never invent IDs. " +
    "Call select_tour_stops with the chosen IDs.";

  const userText =
    `Visitor's wish: "${wish}"\n\nCandidates:\n${candidateList}`;

  const tools = [
    {
      type: "function",
      function: {
        name: "select_tour_stops",
        description: `Select exactly ${stopCount} stops from the candidates that best match the wish.`,
        parameters: {
          type: "object",
          properties: {
            stop_ids: {
              type: "array",
              items: { type: "string" },
              description: `Exactly ${stopCount} IDs (e.g. "p3", "p12") from the candidate list`,
            },
            reasoning: {
              type: "string",
              description: "Why these stops match the wish",
            },
          },
          required: ["stop_ids"],
        },
      },
    },
  ];

  const toolCalls = await callGroq(systemText, userText, tools, apiKey);
  const selectCall = toolCalls.find((tc) => tc.function.name === "select_tour_stops");

  if (!selectCall) throw new Error("Model did not call select_tour_stops");

  const args = JSON.parse(selectCall.function.arguments) as {
    stop_ids: string[];
    reasoning?: string;
  };
  if (args.reasoning) console.log("[planTour] reasoning:", args.reasoning);

  const realIds = args.stop_ids
    .map((h) => handleToId.get(h))
    .filter((id): id is string => id !== undefined);

  if (realIds.length === 0) throw new Error("All returned IDs were invalid");
  return realIds.slice(0, 10);
}
