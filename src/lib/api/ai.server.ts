import type { Coordinates, Itinerary, Landmark } from "../types";

// ── Legacy: per-landmark chat (used by AskAIChat.tsx) ─────────────────────────

export interface ChatMsg {
  role: "user" | "ai";
  content: string;
}

export interface LandmarkContext {
  name: string;
  category: string;
  eyebrow?: string;
  history?: string;
  weeklyHours?: string[];
}

const GUIDE_SYSTEM_PROMPT = `You are VisitMK — an expert local guide for North Macedonia. Help visitors explore Skopje and the wider region: landmarks, restaurants, culture, history, hidden gems, and practical travel tips.

Be warm, concise, and conversational. For place descriptions, be vivid and specific.
For itinerary questions, suggest 3–5 places with brief reasoning.
Keep answers under 150 words. Always write complete sentences — never cut off mid-sentence.
Write in plain text only — no markdown, no asterisks, no bullet dashes.`;

export async function generateAIResponse(
  messages: ChatMsg[],
  landmark: LandmarkContext | undefined,
  apiKey: string,
): Promise<string> {
  let systemText = GUIDE_SYSTEM_PROMPT;

  if (landmark) {
    const parts: string[] = [
      `Context: the user is viewing "${landmark.name}" — a ${landmark.category} in Skopje, North Macedonia.`,
    ];
    if (landmark.eyebrow) parts.push(`Address: ${landmark.eyebrow}.`);
    if (landmark.history) parts.push(`About: ${landmark.history.slice(0, 600)}`);
    if (landmark.weeklyHours?.length) {
      parts.push(`Hours: ${landmark.weeklyHours.slice(0, 4).join(" | ")}.`);
    }
    systemText += "\n\n" + parts.join(" ");
  }

  const chatMessages = messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const body = JSON.stringify({
    model: "deepseek-v4-flash",
    messages: [{ role: "system", content: systemText }, ...chatMessages],
    max_tokens: 1024,
    temperature: 0.75,
  });

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Groq returned an empty response");
  return text.trim();
}

// ── Unified chat: tool-calling loop ──────────────────────────────────────────

export interface UnifiedChatResult {
  content: string;
  placesGroups: Array<{ id: string; label: string; landmarks: Landmark[] }>;
  itinerary: { route: Itinerary; landmarks: Landmark[] } | null;
}

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function buildTourBlock(
  itinerary: Itinerary,
  landmarks: Landmark[],
): string {
  const byId = new Map(landmarks.map((l) => [l.id, l]));
  const ordered = itinerary.stops.slice().sort((a, b) => a.order - b.order);
  const lines = ordered.map((s) => {
    const lm = byId.get(s.landmarkId);
    const name = lm?.name ?? s.landmarkId;
    const cat = lm?.category ?? "?";
    const lat = lm?.coordinates?.lat ?? "?";
    const lng = lm?.coordinates?.lng ?? "?";
    return `  Stop ${s.order}: ${name} — ${cat} — ${s.durationMinutes} min — place_id: ${s.landmarkId} — lat: ${lat} — lng: ${lng}`;
  });
  return [
    `## Current active tour (${ordered.length} stops, ${itinerary.travelMode})`,
    lines.join("\n"),
    `Total: ${Math.floor(itinerary.totalDurationMinutes / 60)}h ${itinerary.totalDurationMinutes % 60}m · ${itinerary.totalDistanceKm.toFixed(1)} km`,
    "To modify the tour, call build_route again with the updated waypoints.",
    "",
  ].join("\n");
}

function buildSystemPrompt(userLocation: Coordinates | null): string {
  const locationLine = userLocation
    ? `The user's current location is lat=${userLocation.lat.toFixed(4)}, lng=${userLocation.lng.toFixed(4)}.`
    : "Use Skopje city center (lat=41.9973, lng=21.428) as the default search location.";

  return `You are VisitMK — an expert local guide and tour planner for Skopje, North Macedonia.
You help visitors discover restaurants, landmarks, culture, nightlife, and plan personalised routes.

${locationLine}

## Tools available
- search_places_nearby: Find places by category (restaurant, museum, park, atm, etc.)
- search_places_by_text: Find places by descriptive query (rooftop bar, vegan food, traditional tavern)
- get_place_details: Get full details (accessibility, payment, features) for a specific place on the map
- get_map_places: List all places currently on the map with their exact IDs
- build_route: Build an optimised route from a list of places (use as LAST step in tour planning)
- find_known_area: Get GPS coordinates for a Skopje neighbourhood (old bazaar, karposh, aerodrom, etc.)

## Stop durations (use these for time budget calculations)
- restaurant / food: 75 min
- café: 45 min
- culture / museum: 60 min
- landmark: 30 min
- outdoors: 90 min
- shopping: 45 min
- travel between stops on foot: ~10 min per leg, ~5 min by car

## Rules
1. ALWAYS call a search tool when the user asks for places — never invent names.
2. NEVER guess or hallucinate coordinates. For ANY request that involves a named location ("near old bazaar", "in Karposh", "around the city square"), call find_known_area FIRST. If the tool returns an error, ask the user to clarify the area — do not invent coordinates.
3. TOUR PLANNING — clarify ONCE, then act:
   When the user asks to build a tour or route (e.g. "make me a tour", "plan a route", "I want to visit some places"), do NOT call any tool yet. Ask these questions in ONE message:
   - How much time do you have? (e.g. 1 hour, 2 hours, half day)
   - Walking or driving?
   - Any preference on area or type of place?
   - Budget preference? (budget / mid-range / upscale) — optional
   - Custom stop times, or use standard times? — optional
   After the user answers (even partially), apply Rule 4 to calculate stop count, then execute this exact sequence WITHOUT asking for confirmation again:
     a. Call find_known_area ONLY if a neighbourhood name was mentioned (not for place names).
     b. Call EXACTLY ONE search. Use show_on_map=false and max_results=N+2. Use a single combined text query (e.g. "landmark cafe restaurant city center Skopje"). NEVER call a second search "per category" or "to verify" or "to get more options" — one search only.
     c. From those results, pick the N best stops. Pass their IDs, coordinates, and categories directly to build_route. Do NOT call get_map_places or find_known_area at this step.
     d. Call build_route immediately.
   PROHIBITED during tour planning: calling search more than once, omitting show_on_map=false from the search, calling get_place_details, calling get_map_places before build_route.
   CRITICAL: NEVER describe the tour in text without FIRST calling build_route. No text output means no route on the map.
4. TIME BUDGET — calculate silently, include in final response:
   a. Compute how many minutes the user has.
   b. Pick the dominant stop type and look up its duration from the table above.
   c. Compute: floor(available_minutes ÷ (stop_duration + 10)) = max stops.
   Do NOT output a message about this calculation before calling tools — proceed directly to find_known_area and search. Include the stop count summary ("Planning N stops, ~Xh Ym total") in your FINAL response after build_route completes.
   Skip to step (c) if the user already told you the stop count explicitly.
5. After search tool results, write 1–3 sentences MAX. The place cards (photo, name, rating, address) are shown automatically in the UI — do NOT describe each individual place in your text. Just write: a one-line intro about what you found, any relevant caveat or uncertainty, and optionally a one-line closing suggestion.
6. After build_route completes, invite refinement: "Does this look good? I can swap any stop, add a café between stops, or adjust for a different area."
6b. TOUR MODIFICATION — when there is a "Current active tour" block AND the user wants to add, swap, or remove a stop:
    a. Search ONLY for the new/replacement stop(s), always with show_on_map=false.
    b. For existing tour stops, use their place_id AND coordinates directly from the "Current active tour" block — do NOT re-search for them, do NOT call get_map_places.
    c. Call build_route with the full updated waypoint list: existing stops (from tour block) + new stop(s).
    d. Never add map pins for existing stops — only the new stop(s) are searched, and only with show_on_map=false.
7. Markdown is supported and renders correctly — use **bold**, bullet lists, and headers where they improve readability. Keep responses concise.
8. get_place_details: call it AT MOST ONCE per turn, and ONLY when the user asks a specific question about a specific named place already shown on the map. Never call it in bulk. If you need the place_id, call get_map_places first — never construct or guess one.
9. Be honest about what you don't know. If the user asks about something the search data cannot confirm, say so clearly BEFORE suggesting places — then still suggest the best matches. Things you cannot confirm: specific dishes or menu items, daily specials, exact dish prices, allergens, real-time wait times, reservation availability.
10. Whenever you are not certain about any claim — a place's specialty, atmosphere, whether it's still operating — say so. Use phrases like "should have", "likely", "known for", "reviews mention", or "I'm not certain but". Never state something as fact you can't confirm from tool results.

## Skopje place types reference
Food: restaurant, fast_food_restaurant, pizza_restaurant, cafe, coffee_shop, bakery, bar, wine_bar, cocktail_bar, pub, night_club
Culture: tourist_attraction, historical_landmark, monument, museum, art_gallery, church, mosque, castle
Outdoors: park, botanical_garden, zoo, amusement_park, hiking_area
Shopping: shopping_mall, market, clothing_store, souvenir_shop, gift_shop
Services: hotel, bank, atm, pharmacy, spa, parking`;
}

export async function executeUnifiedChat(
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  userLocation: Coordinates | null,
  apiKey: string,
  mapboxToken: string,
  persistedLandmarks: Landmark[] = [],
  persistedItinerary: Itinerary | null = null,
): Promise<UnifiedChatResult> {
  const { MCP_TOOLS, executeMCPTool } = await import("../mcp/places-mcp");

  let systemPrompt = buildSystemPrompt(userLocation);
  if (persistedItinerary) {
    systemPrompt += "\n\n" + buildTourBlock(persistedItinerary, persistedLandmarks);
  }

  const systemMessage: GroqMessage = {
    role: "system",
    content: systemPrompt,
  };

  const messages: GroqMessage[] = [
    systemMessage,
    ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
  ];

  const accGroups: Array<{ id: string; label: string; landmarks: Landmark[] }> = [];
  let accItinerary: { route: Itinerary; landmarks: Landmark[] } | null = null;
  // Seed with landmarks from previous turns so get_map_places can see them
  const allKnownLandmarks: Landmark[] = [...persistedLandmarks];

  const MAX_ITERATIONS = 8;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`\n[MCP] ── iteration ${iterations} ──────────────────────`);

    const body = JSON.stringify({
      model: "deepseek-v4-flash",
      messages,
      tools: MCP_TOOLS,
      tool_choice: "auto",
      max_tokens: 4096,
      temperature: 0.7,
    });

    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`DeepSeek API ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        finish_reason: string;
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };

    const choice = data.choices?.[0];
    if (!choice) throw new Error("DeepSeek returned no choices");

    const assistantMsg = choice.message;
    console.log(`[MCP] finish_reason: ${choice.finish_reason}`);

    messages.push({ role: "assistant", content: assistantMsg.content, tool_calls: assistantMsg.tool_calls });

    if (choice.finish_reason === "stop" || !assistantMsg.tool_calls?.length) {
      console.log(`[MCP] final response:\n${assistantMsg.content ?? ""}`);
      // When a route was built, discard search pin groups — the numbered route stops replace them
      return {
        content: (assistantMsg.content ?? "").trim(),
        placesGroups: accItinerary ? [] : accGroups,
        itinerary: accItinerary,
      };
    }

    // Execute all tool calls in this turn (may be multiple)
    const toolResults = await Promise.all(
      assistantMsg.tool_calls.map(async (tc) => {
        let args: unknown;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        console.log(`[MCP] → tool call: ${tc.function.name}`);
        console.log(`[MCP]   args:`, JSON.stringify(args, null, 2));

        const result = await executeMCPTool(
          tc.function.name,
          args,
          process.env.GOOGLE_PLACES_API_KEY ?? "",
          mapboxToken,
          userLocation,
          allKnownLandmarks,
        );

        console.log(`[MCP] ← result from ${tc.function.name}:`, result.llmContent.slice(0, 300));
        if (result.landmarks?.length) {
          console.log(`[MCP]   landmarks returned: ${result.landmarks.length} (label: "${result.groupLabel}")`);
        }
        if (result.itinerary) {
          console.log(`[MCP]   itinerary: ${result.itinerary.stops.length} stops, ${result.itinerary.totalDurationMinutes} min`);
        }

        // Accumulate map data
        if (result.landmarks?.length) {
          // Always seed allKnownLandmarks so get_map_places can see them
          allKnownLandmarks.push(...result.landmarks);
          // Only add map pins when showOnMap is not explicitly false
          if (result.showOnMap !== false) {
            const groupId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            accGroups.push({ id: groupId, label: result.groupLabel ?? tc.function.name, landmarks: result.landmarks });
          }
        }
        if (result.itinerary) {
          accItinerary = { route: result.itinerary, landmarks: result.itineraryLandmarks ?? [] };
        }

        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: result.llmContent,
        };
      }),
    );

    messages.push(...toolResults);
  }

  console.log(`[MCP] hit max iterations (${MAX_ITERATIONS}), returning early`);
  return {
    content: "I found some places for you! Check the map for the results.",
    placesGroups: accItinerary ? [] : accGroups,
    itinerary: accItinerary,
  };
}
