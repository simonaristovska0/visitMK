// ─────────────────────────────────────────────────────────────────────────────
// places.functions.ts
//
// This file is the BRIDGE between the browser (React components) and the
// server-side Google Places logic in places.server.ts.
//
// WHY THIS FILE EXISTS:
//   Browser code cannot directly call places.server.ts — that code runs on the
//   server and uses secret API keys that must never reach the browser.
//   TanStack Start's createServerFn() creates a special "server function":
//   from the browser's perspective it looks like a normal async function call,
//   but under the hood TanStack serialises the call into an HTTP request,
//   sends it to the server, runs the handler there, and returns the result.
//   The browser never sees the API key or the actual server code.
//
// WHO CALLS THIS FILE (the browser side):
//   - ExploreView.tsx  → calls getTopAttractions() and getTopRestaurants()
//   - PlanView.tsx     → calls getTopAttractions()
//
// WHAT THIS FILE CALLS (the server side):
//   - places.server.ts → getTopAttractionsNearSkopje()
//   - places.server.ts → getTopRestaurantsNearSkopje()
//   - places.server.ts → searchRestaurantsByText()
//
// PATTERN used throughout:
//   createServerFn({ method }) — declares the HTTP method (GET or POST)
//   .inputValidator(zodSchema) — validates and types the input on the server
//                                before the handler runs (POST only)
//   .handler(async ({ data }) => { ... }) — the actual server-side logic
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Handler bodies are server-only (tree-shaken from client).
// The .server.ts import below never reaches the browser.

// ─────────────────────────────────────────────────────────────────────────────
// getTopAttractions
//
// USED BY:
//   - PlanView.tsx   → useQuery(["top-attractions"], () => getTopAttractions())
//   - ExploreView.tsx → useQuery(["top-attractions"], () => getTopAttractions())
//
// Both components share the same React Query cache key "top-attractions",
// so even though two components call this, only ONE actual HTTP request is ever
// made — React Query serves the second component from cache.
//
// METHOD: GET (no input needed — always returns Skopje attractions)
//
// What happens on the server when this is called:
//   1. Reads GOOGLE_PLACES_API_KEY from process.env (server-only, never sent to browser)
//   2. Calls getTopAttractionsNearSkopje() from places.server.ts
//   3. That function makes 12 parallel Google Places API calls (tourist attractions,
//      museums, churches, mosques, parks, malls, etc.)
//   4. Results are cached server-side for 6 hours
//   5. Returns { attractions: Landmark[] }
//
// Throws if GOOGLE_PLACES_API_KEY is missing or is still the placeholder value.
// ─────────────────────────────────────────────────────────────────────────────
export const getTopAttractions = createServerFn({ method: "GET" }).handler(async () => {
  const { getTopAttractionsNearSkopje } = await import("./places.server");
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured in .env");
  }
  const attractions = await getTopAttractionsNearSkopje(apiKey);
  return { attractions };
});

// ─────────────────────────────────────────────────────────────────────────────
// getTopRestaurants
//
// USED BY:
//   - ExploreView.tsx → useQuery(["top-restaurants"], () => getTopRestaurants())
//
// METHOD: GET (no input needed — always returns Skopje restaurants)
//
// What happens on the server when this is called:
//   1. Reads GOOGLE_PLACES_API_KEY from process.env
//   2. Calls getTopRestaurantsNearSkopje() from places.server.ts
//   3. That function makes 5 parallel Google Places API calls (restaurants,
//      cafés, coffee shops, bakeries, bars across 2 geographic areas)
//   4. Results are cached server-side for 1 hour (shorter than attractions
//      because restaurant open/close status changes more often)
//   5. Returns { restaurants: Landmark[] }
// ─────────────────────────────────────────────────────────────────────────────
export const getTopRestaurants = createServerFn({ method: "GET" }).handler(async () => {
  const { getTopRestaurantsNearSkopje } = await import("./places.server");
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured in .env");
  }
  const restaurants = await getTopRestaurantsNearSkopje(apiKey);
  return { restaurants };
});

// ─────────────────────────────────────────────────────────────────────────────
// searchRestaurants
//
// USED BY: not yet wired to any UI component — defined but not called from the
//          browser yet. Ready for a future "search" feature.
//
// METHOD: POST (because it takes user input — the search query)
//
// Input validation with Zod:
//   - query: must be a non-empty string (the user's search text, e.g. "italian pizza")
//   - maxResults: integer between 1 and 20, defaults to 5 if not provided
//
// Zod runs on the SERVER before the handler — if the input doesn't match
// the schema, the request is rejected with a validation error before any
// Google API calls are made.
//
// What happens on the server when this is called:
//   1. Validates input via Zod schema
//   2. Reads GOOGLE_PLACES_API_KEY from process.env
//   3. Calls searchRestaurantsByText() from places.server.ts
//   4. That function makes ONE Google Places searchText API call (live, no cache)
//   5. Returns { restaurants: Landmark[] }
// ─────────────────────────────────────────────────────────────────────────────
export const searchRestaurants = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      query: z.string().min(1),                                   // e.g. "traditional macedonian food"
      maxResults: z.number().int().min(1).max(20).optional().default(5), // how many results to return
    }),
  )
  .handler(async ({ data }) => {
    // data is fully typed and validated by Zod at this point
    const { searchRestaurantsByText } = await import("./places.server");
    const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
    if (!apiKey || apiKey === "your_key_here") {
      throw new Error("GOOGLE_PLACES_API_KEY is not configured in .env");
    }
    const restaurants = await searchRestaurantsByText(data.query, data.maxResults, apiKey);
    return { restaurants };
  });
