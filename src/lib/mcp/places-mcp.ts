// ─────────────────────────────────────────────────────────────────────────────
// places-mcp.ts — SERVER ONLY
//
// This file is the core of the MCP (Model Context Protocol) layer.
// It does two things:
//
//   1. Defines MCP_TOOLS — an array of JSON schemas in OpenAI function-calling
//      format. This array is sent to DeepSeek alongside every chat request so
//      the LLM knows what tools exist and how to call them. Each schema
//      contains a `description` (what the tool does / when to call it) and
//      `parameters` (what arguments to supply). The LLM reads ONLY these
//      descriptions — it never sees the implementation code below.
//
//   2. Implements executeMCPTool() — the server-side dispatcher that actually
//      runs the tool once the LLM has decided to call it. It receives the
//      tool name + arguments the LLM generated, makes the real API calls
//      (Google Places, Mapbox, wttr.in), and returns both:
//        - llmContent: a JSON string fed back to the LLM as the tool result
//        - landmarks / itinerary: structured data forwarded to the frontend
//          so the map can update (add pins, draw route) without the LLM
//          having to re-describe every place coordinate.
//
// FLOW (per chat turn):
//   browser → ai.functions.ts → ai.server.ts → DeepSeek API
//     → LLM returns tool_calls → executeMCPTool() → Google Places API
//     → result fed back to LLM → LLM produces final text
//     → { content, placesGroups, itinerary } returned to browser
//
// TOOLS OVERVIEW:
//   1. search_places_nearby   — category search (restaurant, museum, atm …)
//   2. search_places_by_text  — free-text search (rooftop bar, vegan food …)
//   3. get_place_details      — full details for one place (accessibility, payments …)
//   4. build_route            — Mapbox-optimised itinerary from a list of places
//   5. find_known_area        — static lat/lng lookup for Skopje neighbourhoods
//   6. get_map_places          — list all known places on the map with their IDs
// ─────────────────────────────────────────────────────────────────────────────

import type { Category, Coordinates, Itinerary, Landmark, PlaceAttributes } from "@/lib/types";
import { buildItinerary } from "@/lib/api/itinerary.server";
import { withSatelliteFallback } from "@/lib/api/wikipedia.server";

// ─────────────────────────────────────────────────────────────────────────────
// MCPToolResult
//
// Every executor function returns this shape. The two parts serve different
// consumers:
//
//   llmContent        → serialised as a "tool" role message and appended to the
//                        DeepSeek conversation so the LLM can read the result
//                        and compose its next action or final reply.
//                        Always a JSON string — keep it concise (no full photo
//                        URLs etc.) so it fits in the context window cheaply.
//
//   landmarks         → full Landmark[] objects (with photo URLs, coordinates,
//                        opening hours…) forwarded to the frontend to add map
//                        pins. NOT sent to the LLM.
//
//   groupLabel        → the chip label shown at the bottom of the map
//                        (e.g. "Top Restaurants", "Museums"). Derived by the
//                        executor from the query when the LLM doesn't supply it.
//
//   itinerary         → full Itinerary object (stops, legs, totals) forwarded
//                        to the frontend to draw the route polyline and show
//                        the ActiveTourWidget. NOT sent to the LLM (only a
//                        summary is included in llmContent).
//
//   itineraryLandmarks → full Landmark objects for each route stop, needed by
//                        the ActiveTourWidget to show thumbnails and addresses.
// ─────────────────────────────────────────────────────────────────────────────

export interface MCPToolResult {
  llmContent: string;
  landmarks?: Landmark[];
  groupLabel?: string;
  // When false, landmarks are added to allKnownLandmarks (for get_map_places) but NOT shown as map pins.
  // Used during tour planning searches so intermediate results don't clutter the map.
  showOnMap?: boolean;
  itinerary?: Itinerary;
  itineraryLandmarks?: Landmark[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GroqTool / GroqFunction
//
// TypeScript mirrors of the OpenAI function-calling schema format used by
// DeepSeek (the API is fully OpenAI-compatible). The `function.description`
// and each `parameters.properties[field].description` are the strings the LLM
// actually reads to decide when and how to call a tool.
// ─────────────────────────────────────────────────────────────────────────────

interface GroqFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface GroqTool {
  type: "function";
  function: GroqFunction;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Places API — field masks
//
// The Google Places API (New) bills per field group, so we request only what
// we actually use. X-Goog-FieldMask is a comma-separated list of dot-paths.
//
// SEARCH_FIELD_MASK — used for search tools (1 & 2).
//   Includes all the rich attributes (dineIn, outdoorSeating, paymentOptions …)
//   so the LLM and the detail sheet can answer questions like "does it have
//   outdoor seating?" without a follow-up get_place_details call.
//   Billing tier: Basic + Advanced + Preferred data fields.
//
// DETAILS_FIELD_MASK — used for get_place_details (tool 3).
//   Everything SEARCH_FIELD_MASK covers PLUS: full reviews array, secondary
//   opening hours (e.g. happy hour, kitchen hours), parking, and attributions.
//   Called only on demand when the user asks a specific question about a place,
//   so the higher billing cost is justified by the direct user intent.
//
// OPENING_FIELD_MASK — used for check_opening_status (tool 4).
//   Intentionally minimal: we only need the openNow flag, today's hours string,
//   and the RFC3339 next open/close timestamps. The cheapest possible call.
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_FIELD_MASK = [
  // Core identity
  "places.id", "places.displayName", "places.primaryType", "places.primaryTypeDisplayName",
  // Location & rating
  "places.location", "places.rating", "places.userRatingCount", "places.priceLevel",
  // Status & hours
  "places.businessStatus", "places.currentOpeningHours", "places.regularOpeningHours",
  // Address & description
  "places.shortFormattedAddress", "places.editorialSummary", "places.photos",
  // Contact
  "places.nationalPhoneNumber", "places.websiteUri", "places.googleMapsUri",
  // Dining attributes (used by the LLM to answer follow-up questions and filter results)
  "places.dineIn", "places.takeout", "places.delivery", "places.reservable",
  "places.outdoorSeating", "places.liveMusic", "places.goodForChildren",
  "places.allowsDogs", "places.servesVegetarianFood", "places.servesBeer",
  "places.servesWine", "places.servesCoffee", "places.goodForGroups",
  // Payment & accessibility (used by the LLM for "does it accept cards?" type questions)
  "places.paymentOptions", "places.accessibilityOptions",
].join(",");

const DETAILS_FIELD_MASK = [
  // Core identity (no "places." prefix — this is a GET /places/{id} call, not a search)
  "id", "displayName", "primaryType", "primaryTypeDisplayName", "types", "location",
  "formattedAddress", "shortFormattedAddress", "googleMapsUri",
  // Ratings
  "rating", "userRatingCount", "priceLevel", "businessStatus",
  // Full hours including secondary schedules (e.g. happy hour, kitchen close)
  "currentOpeningHours", "regularOpeningHours",
  "currentSecondaryOpeningHours", "regularSecondaryOpeningHours", "utcOffsetMinutes",
  // Contact
  "nationalPhoneNumber", "internationalPhoneNumber", "websiteUri",
  // Content
  "editorialSummary", "photos", "reviews",
  // All dining flags
  "dineIn", "takeout", "delivery", "reservable",
  "servesBreakfast", "servesLunch", "servesDinner", "servesBrunch",
  "servesBeer", "servesWine", "servesCocktails", "servesCoffee", "servesDessert", "servesVegetarianFood",
  "outdoorSeating", "liveMusic", "goodForChildren", "allowsDogs", "restroom", "goodForGroups", "menuForChildren",
  // Facilities
  "paymentOptions", "parkingOptions", "accessibilityOptions", "attributions",
].join(",");


// ─────────────────────────────────────────────────────────────────────────────
// SKOPJE_AREAS — static coordinate lookup for Tool 6 (find_known_area)
//
// The LLM is instructed to call find_known_area before any place search when
// the user mentions a named neighbourhood. This avoids the LLM having to
// hallucinate coordinates, and guarantees accurate center points.
//
// radius is the suggested search radius in meters to pass to search tools
// for that area. It reflects the physical size of the neighbourhood:
//   - City square (ploštad): 1 km — very compact, just the square and surroundings
//   - Old Bazaar / Čaršija: 1.5 km — the historic market district
//   - City center: 2 km — the commercial core
//   - Residential areas (Karposh, Aerodrom, Chair): 3 km
//   - Vodno: 4 km — the mountain area
//   - Matka: 5 km — canyon / nature area far from center
//   - Whole Skopje: 15 km — city-wide search
// ─────────────────────────────────────────────────────────────────────────────

const SKOPJE_AREAS: Record<string, { lat: number; lng: number; radius: number }> = {
  "old bazaar":   { lat: 42.001,   lng: 21.435,  radius: 1500  },
  "carsija":      { lat: 42.001,   lng: 21.435,  radius: 1500  },
  "city center":  { lat: 41.9973,  lng: 21.428,  radius: 2000  },
  "city square":  { lat: 41.9962,  lng: 21.4314, radius: 1000  },
  "karposh":      { lat: 41.998,   lng: 21.396,  radius: 3000  },
  "aerodrom":     { lat: 41.973,   lng: 21.451,  radius: 3000  },
  "gazi baba":    { lat: 41.994,   lng: 21.497,  radius: 3000  },
  "chair":        { lat: 42.010,   lng: 21.450,  radius: 2000  },
  "vodno":        { lat: 41.959,   lng: 21.408,  radius: 4000  },
  "matka":        { lat: 41.943,   lng: 21.313,  radius: 5000  },
  "skopje":       { lat: 41.9973,  lng: 21.428,  radius: 15000 },
};

// Maps Google's PRICE_LEVEL enum strings to human-readable euro signs shown on cards
const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE:   "€",
  PRICE_LEVEL_MODERATE:      "€€",
  PRICE_LEVEL_EXPENSIVE:     "€€€",
  PRICE_LEVEL_VERY_EXPENSIVE: "€€€€",
};

// ─────────────────────────────────────────────────────────────────────────────
// RawPlace — the shape returned directly by the Google Places API (New).
//
// Every field is optional (?) because Google may omit any field that has no
// data for a given place. The API does NOT return null for missing fields —
// it simply omits them entirely.
//
// currentOpeningHours vs regularOpeningHours:
//   - currentOpeningHours: reflects exceptional closures (public holidays etc.)
//     and includes openNow, nextOpenTime, nextCloseTime.
//   - regularOpeningHours: the normal weekly schedule, no open-now flag.
//   We prefer currentOpeningHours for the live status and fall back to
//   regularOpeningHours for the weekday text descriptions.
// ─────────────────────────────────────────────────────────────────────────────

interface RawPlace {
  id: string;
  displayName?: { text: string };
  primaryType?: string;                 // e.g. "restaurant", "tourist_attraction"
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;                  // e.g. "PRICE_LEVEL_MODERATE"
  businessStatus?: string;              // "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY"
  location?: { latitude: number; longitude: number };
  currentOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];     // ["Monday: 9:00 AM – 10:00 PM", …]
    nextOpenTime?: string;              // RFC3339, present when currently closed
    nextCloseTime?: string;             // RFC3339, present when currently open
  };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  shortFormattedAddress?: string;       // e.g. "Ploštad Makedonija, Skopje"
  editorialSummary?: { text: string };  // Google's editorial blurb
  photos?: Array<{ name: string }>;     // resource names — need a second API call to resolve to URLs
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  // Dining attributes
  dineIn?: boolean;
  takeout?: boolean;
  delivery?: boolean;
  reservable?: boolean;
  outdoorSeating?: boolean;
  liveMusic?: boolean;
  goodForChildren?: boolean;
  allowsDogs?: boolean;
  servesVegetarianFood?: boolean;
  servesBeer?: boolean;
  servesWine?: boolean;
  servesCoffee?: boolean;
  goodForGroups?: boolean;
  paymentOptions?: PlaceAttributes["paymentOptions"];
  accessibilityOptions?: PlaceAttributes["accessibilityOptions"];
}

// ─────────────────────────────────────────────────────────────────────────────
// resolvePhotoUrl
//
// Google Places API does NOT return image URLs directly. Instead it returns
// "photo resource names" like "places/ChIJ.../photos/AUc...".
// To get an actual image URL you must make a second API call:
//   GET https://places.googleapis.com/v1/{photoName}/media
//     ?maxWidthPx=800
//     &skipHttpRedirect=true   ← return JSON {photoUri} instead of 302
//     &key={apiKey}            ← key goes in query param for media endpoint
//
// Returns "" on any failure so callers can silently fall back to satellite imagery.
// ─────────────────────────────────────────────────────────────────────────────

async function resolvePhotoUrl(photoName: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&skipHttpRedirect=true&key=${apiKey}`,
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { photoUri?: string };
    return data.photoUri ?? "";
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// guessCategory
//
// Maps a Google primaryType string to our app's Category union.
// Google uses snake_case type names (e.g. "pizza_restaurant", "art_gallery").
// We do a regex match so partial strings work (e.g. "italian_restaurant" → food).
// Falls back to "landmark" for anything unrecognised.
// ─────────────────────────────────────────────────────────────────────────────

function guessCategory(primaryType: string | undefined): Category {
  if (!primaryType) return "landmark";
  if (/restaurant|food|pizza|grill|tavern|diner/.test(primaryType))               return "food";
  if (/cafe|coffee|bakery|pastry|tea/.test(primaryType))                          return "cafe";
  if (/bar|pub|night_club|cocktail|wine/.test(primaryType))                       return "food";
  if (/museum|gallery|theater|cinema|cultural|monument|church|mosque|synagogue|castle/.test(primaryType)) return "culture";
  if (/park|garden|zoo|amusement|hiking|nature|forest/.test(primaryType))         return "outdoors";
  if (/mall|shop|store|market|boutique|clothing/.test(primaryType))               return "shopping";
  if (/tourist_attraction|landmark|point_of_interest/.test(primaryType))          return "landmark";
  return "landmark";
}

const SKOPJE_CENTER = { lat: 41.9973, lng: 21.428 };

// ─────────────────────────────────────────────────────────────────────────────
// walkMins
//
// Straight-line walking time from the user's location (or Skopje center as
// fallback) to the given coordinates. Uses the Haversine formula for the
// distance, then divides by 83.3 m/min (5 km/h walking speed).
// Shown on landmark cards as "~8 min walk". Minimum 1 minute.
// ─────────────────────────────────────────────────────────────────────────────

function walkMins(lat: number, lng: number, userLat?: number, userLng?: number): number {
  const fromLat = userLat ?? SKOPJE_CENTER.lat;
  const fromLng = userLng ?? SKOPJE_CENTER.lng;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - fromLat);
  const dLng = toRad(lng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.ceil(dist / 83.3));
}

// ─────────────────────────────────────────────────────────────────────────────
// rawToLandmark
//
// Converts a single Google Places API result into the app's internal Landmark
// shape. This is the "translation layer" between Google's format and the UI.
//
// Notable transformations:
//   id         — prefixed with "places_" to distinguish from OSM landmark IDs
//   category   — guessed from primaryType via guessCategory()
//   openingHours.open/close — parsed from today's weekday description string
//                e.g. "Monday: 9:00 AM – 10:00 PM" → open: "9:00 AM", close: "10:00 PM"
//   walkTimeMinutes — straight-line haversine from user location
//   heroImage  — always starts as "" — filled in later by resolvePlacePhotos()
//   attributes — all the boolean dining/accessibility flags stored for detail sheet
//
// Google weekday array is 0=Monday…6=Sunday.
// JS Date.getDay() is 0=Sunday…6=Saturday.
// Conversion: JS 0 → Google index 6, JS 1–6 → Google index 0–5.
// ─────────────────────────────────────────────────────────────────────────────

function rawToLandmark(p: RawPlace, userLocation?: Coordinates | null): Landmark {
  const lat = p.location?.latitude ?? SKOPJE_CENTER.lat;
  const lng = p.location?.longitude ?? SKOPJE_CENTER.lng;
  const openNow = p.currentOpeningHours?.openNow ?? false;
  // Prefer currentOpeningHours descriptions (reflects today's exceptions);
  // fall back to regularOpeningHours if current is absent
  const weekly =
    p.regularOpeningHours?.weekdayDescriptions ??
    p.currentOpeningHours?.weekdayDescriptions ??
    [];
  const todayHours = weekly[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] ?? "";
  const timeMatch = todayHours.match(/(\d{1,2}:\d{2}\s?[AP]M)\s*[–\-]\s*(\d{1,2}:\d{2}\s?[AP]M)/i);

  const attributes: PlaceAttributes = {
    googleMapsUri: p.googleMapsUri,
    dineIn: p.dineIn,
    takeout: p.takeout,
    delivery: p.delivery,
    reservable: p.reservable,
    outdoorSeating: p.outdoorSeating,
    liveMusic: p.liveMusic,
    goodForChildren: p.goodForChildren,
    allowsDogs: p.allowsDogs,
    servesVegetarianFood: p.servesVegetarianFood,
    servesBeer: p.servesBeer,
    servesWine: p.servesWine,
    servesCoffee: p.servesCoffee,
    goodForGroups: p.goodForGroups,
    paymentOptions: p.paymentOptions,
    accessibilityOptions: p.accessibilityOptions,
  };

  return {
    id: `places_${p.id}`,
    name: p.displayName?.text ?? "Place",
    category: guessCategory(p.primaryType),
    coordinates: { lat, lng },
    rating: Math.round((p.rating ?? 0) * 10) / 10,
    reviewCount: p.userRatingCount ?? 0,
    priceMKD: 0,                                    // Google doesn't provide MKD prices
    priceLabel: PRICE_LABEL[p.priceLevel ?? ""],
    openingHours: {
      open:    timeMatch?.[1] ?? "09:00",
      close:   timeMatch?.[2] ?? "23:00",
      openNow,
    },
    weeklyHours: weekly.length ? weekly : undefined,
    walkTimeMinutes: walkMins(lat, lng, userLocation?.lat, userLocation?.lng),
    heroImage: "",                                  // resolved asynchronously in resolvePlacePhotos()
    eyebrow: p.shortFormattedAddress,
    history: p.editorialSummary?.text ?? "",
    practicalInfo: weekly.join("\n"),
    phone: p.nationalPhoneNumber,
    website: p.websiteUri,
    attributes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolvePlacePhotos
//
// Takes a batch of raw places and the corresponding Landmark array (same index
// = same place) and resolves the first photo for each place in parallel.
// Uses Promise.allSettled so a single failed photo request doesn't abort the
// whole batch — that landmark just keeps heroImage: "".
//
// Photo resolution is deliberately done separately from rawToLandmark() because
// it requires async API calls and we want to fire them all in parallel.
// ─────────────────────────────────────────────────────────────────────────────

async function resolvePlacePhotos(
  places: RawPlace[],
  landmarks: Landmark[],
  apiKey: string,
): Promise<Landmark[]> {
  const results = await Promise.allSettled(
    places.map((p) => {
      const name = p.photos?.[0]?.name; // take only the first photo
      return name ? resolvePhotoUrl(name, apiKey) : Promise.resolve("");
    }),
  );
  return landmarks.map((lm, i) => {
    const r = results[i];
    const url = r.status === "fulfilled" ? r.value : "";
    return url ? { ...lm, heroImage: url } : lm;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// placesPost
//
// Sends a POST request to any Google Places (New) search endpoint.
// Google Places API (New) uses POST for all search operations (unlike the
// legacy API which used GET). The field mask is passed in the X-Goog-FieldMask
// header and controls both what data is returned and what is billed.
//
// endpoint examples: "searchNearby", "searchText"
// Full URL: POST https://places.googleapis.com/v1/places:{endpoint}
// ─────────────────────────────────────────────────────────────────────────────

async function placesPost(
  endpoint: string,
  body: object,
  apiKey: string,
  fieldMask: string,
): Promise<RawPlace[]> {
  const res = await fetch(`https://places.googleapis.com/v1/places:${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Places API ${endpoint}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.places ?? []) as RawPlace[];
}

// ─────────────────────────────────────────────────────────────────────────────
// placesGet
//
// Fetches full details for a single place by its Google Place ID.
// This is a GET request (unlike searches which are POST).
// Full URL: GET https://places.googleapis.com/v1/places/{placeId}
//
// Returns null if the place is not found or the API errors, so callers can
// gracefully handle "place no longer exists" without throwing.
// ─────────────────────────────────────────────────────────────────────────────

async function placesGet(
  placeId: string,
  apiKey: string,
  fieldMask: string,
): Promise<RawPlace | null> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawPlace;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 1 — 

//
// PURPOSE: Find places of a specific Google type within a circular area.
// Use for category-based requests: "restaurants near me", "ATMs nearby",
// "museums in the old bazaar".
//
// HOW THE LLM USES IT:
//   - Picks included_types from the Google place types reference (in system prompt)
//   - Uses find_known_area first to get coordinates when a neighbourhood is named
//   - Uses rank_by=DISTANCE for "nearest X" requests, POPULARITY otherwise
//   - Supplies a group_label for the map chip (e.g. "Top Restaurants")
//
// API CALL: POST https://places.googleapis.com/v1/places:searchNearby
//   locationRestriction (hard circle) — results outside the circle are excluded
//   vs. locationBias (soft circle, used in Tool 2) — results can still appear
//   from outside the circle if they're highly relevant.
//
// PIPELINE after API call:
//   1. Filter out CLOSED_PERMANENTLY places
//   2. rawToLandmark() — converts each result to our Landmark shape
//   3. resolvePlacePhotos() — parallel photo URL resolution (second API call per place)
//   4. withSatelliteFallback() — any place still missing a photo gets a Mapbox satellite tile
//
//So the fallback chain is:
//Google photo resolved → use it
//Google photo missing/failed → Mapbox satellite tile of the exact location
//
// WHAT THE LLM GETS BACK (llmContent):
//   { found: 8, group_label: "Top Restaurants", places: [{ id, name, rating, address, open_now, price }, …] }
//   — a compact summary, not the full Landmark objects. The full objects go to the map.
// ─────────────────────────────────────────────────────────────────────────────

interface SearchNearbyArgs {
  included_types: string[];
  latitude: number;
  longitude: number;
  radius_meters: number;
  max_results: number;
  rank_by: "POPULARITY" | "DISTANCE";
  group_label?: string;
  show_on_map?: boolean;
}

async function execSearchNearby(
  args: SearchNearbyArgs,
  apiKey: string,
  mapboxToken: string,
  userLocation?: Coordinates | null,
): Promise<MCPToolResult> {
  const places = await placesPost(
    "searchNearby",
    {
      includedTypes: args.included_types,
      maxResultCount: Math.min(args.max_results ?? 10, 20),
      rankPreference: args.rank_by ?? "POPULARITY",
      locationRestriction: {
        circle: {
          center: { latitude: args.latitude, longitude: args.longitude },
          radius: args.radius_meters ?? 5000,
        },
      },
    },
    apiKey,
    SEARCH_FIELD_MASK,
  );

  const operational = places.filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY");
  const landmarks = operational.map((p) => rawToLandmark(p, userLocation));
  const withPhotos = await resolvePlacePhotos(operational, landmarks, apiKey);
  const withFallback = withSatelliteFallback(withPhotos, mapboxToken);

  // Auto-generate a readable chip label from the first included type if LLM didn't supply one
  const groupLabel =
    args.group_label ??
    (args.included_types[0] ?? "Places")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // Send a compact summary back to the LLM — include coordinates so it can pass them
  // directly to build_route without needing a get_place_details call for coords.
  const llmSummary = withFallback.slice(0, 8).map((l) => ({
    id: l.id,
    name: l.name,
    rating: l.rating,
    address: l.eyebrow,
    open_now: l.openingHours.openNow,
    price: l.priceLabel,
    lat: l.coordinates.lat,
    lng: l.coordinates.lng,
  }));

  return {
    llmContent: JSON.stringify({ found: withFallback.length, group_label: groupLabel, places: llmSummary }),
    landmarks: withFallback,
    groupLabel,
    showOnMap: args.show_on_map !== false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 2 — search_places_by_text
//
// PURPOSE: Free-text search for places. Use when the user describes a place
// qualitatively rather than by type category: "rooftop bar with a view",
// "traditional Macedonian tavern", "quiet café with wifi", "vegan restaurant".
//
// HOW IT DIFFERS FROM TOOL 1:
//   - Uses /places:searchText (text query) instead of /places:searchNearby (type filter)
//   - Uses locationBias (soft circle) instead of locationRestriction (hard circle),
//     so highly-relevant places slightly outside the radius can still appear
//   - Adds a minimum rating filter (≥ 3.0) because text searches return more noise
//
// WHAT THE LLM GETS BACK: same compact summary format as Tool 1.
// ─────────────────────────────────────────────────────────────────────────────

interface SearchByTextArgs {
  query: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  max_results: number;
  group_label?: string;
  show_on_map?: boolean;
}

async function execSearchByText(
  args: SearchByTextArgs,
  apiKey: string,
  mapboxToken: string,
  userLocation?: Coordinates | null,
): Promise<MCPToolResult> {
  const places = await placesPost(
    "searchText",
    {
      textQuery: args.query,
      maxResultCount: Math.min(args.max_results ?? 8, 20),
      locationBias: {
        circle: {
          center: { latitude: args.latitude, longitude: args.longitude },
          radius: args.radius_meters ?? 10000,
        },
      },
    },
    apiKey,
    SEARCH_FIELD_MASK,
  );

  // Text search tends to return more irrelevant results than nearby search,
  // so we apply a minimum rating floor and remove permanently closed places
  const operational = places.filter(
    (p) => p.businessStatus !== "CLOSED_PERMANENTLY" && (p.rating ?? 0) >= 3.0,
  );
  const landmarks = operational.map((p) => rawToLandmark(p, userLocation));
  const withPhotos = await resolvePlacePhotos(operational, landmarks, apiKey);
  const withFallback = withSatelliteFallback(withPhotos, mapboxToken);

  // Title-case the query as the chip label, truncated to 30 chars
  const groupLabel =
    args.group_label ??
    args.query.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 30);

  const llmSummary = withFallback.slice(0, 8).map((l) => ({
    id: l.id,
    name: l.name,
    rating: l.rating,
    address: l.eyebrow,
    open_now: l.openingHours.openNow,
    price: l.priceLabel,
    lat: l.coordinates.lat,
    lng: l.coordinates.lng,
  }));

  return {
    llmContent: JSON.stringify({ found: withFallback.length, group_label: groupLabel, places: llmSummary }),
    landmarks: withFallback,
    groupLabel,
    showOnMap: args.show_on_map !== false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 3 — get_place_details
//
// PURPOSE: Fetch comprehensive details for a single place already shown on the
// map. Called when the user asks a specific question about a particular place:
//   "Is this wheelchair accessible?"
//   "Does this restaurant take cards?"
//   "What time does it close tonight?"
//   "Does it have outdoor seating?"
//
// Unlike the search tools, this does NOT add any pins to the map — the place is
// already there. The LLM reads the full JSON response and answers the user.
//
// API CALL: GET https://places.googleapis.com/v1/places/{placeId}
// Uses DETAILS_FIELD_MASK (the richest and most expensive field mask).
//
// Our internal IDs are prefixed with "places_" (e.g. "places_ChIJ...").
// The Google API expects the raw ID without the prefix, so we strip it here.
// ─────────────────────────────────────────────────────────────────────────────

interface GetDetailsArgs { place_id: string }

async function execGetPlaceDetails(args: GetDetailsArgs, apiKey: string): Promise<MCPToolResult> {
  // Strip our internal "places_" prefix to get the raw Google Place ID
  const rawId = args.place_id.replace(/^places_/, "");
  const place = await placesGet(rawId, apiKey, DETAILS_FIELD_MASK);
  if (!place) return { llmContent: JSON.stringify({ error: "Place not found" }) };
  // Return the full raw JSON to the LLM — it's comprehensive enough to answer any question
  return { llmContent: JSON.stringify(place) };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 4 — build_route
//
// PURPOSE: Build an optimised tour itinerary from a list of waypoints. This
// should be the LAST tool called in the tour planning flow, after the LLM has:
//   1. Found candidate places (Tools 1 or 2)
//   2. Checked the weather (Tool 7)
//   3. Verified which candidates are open (Tool 4)
//
// Under the hood it delegates to itinerary.server.ts which calls:
//   - Mapbox Matrix API: computes a travel-time matrix between all waypoints
//     and runs a greedy nearest-neighbour algorithm to find the optimal order
//   - Mapbox Directions API: fetches the real road geometry and per-leg
//     distances/durations for the ordered stops
//
// The waypoints must include place_id (our "places_..." format), coordinates,
// and category. The LLM should supply all three from the search results it
// already has in context.
//
// WHAT THE LLM GETS BACK (compact summary):
//   { route_id, stops, total_duration_minutes, total_distance_km, travel_mode, stop_names }
//
// WHAT GOES TO THE FRONTEND:
//   - Full Itinerary object → drawn on map as a polyline with numbered pins
//   - Landmark objects for each stop → shown in ActiveTourWidget
// ─────────────────────────────────────────────────────────────────────────────

interface BuildRouteArgs {
  waypoints: Array<{
    place_id: string;
    coordinates: { lat: number; lng: number };
    category: string;
    visit_duration_minutes?: number; // custom stay time; omit to use category default
  }>;
  travel_mode: "walking" | "driving";
  optimize_order: boolean;
  wish?: string;
}

async function execBuildRoute(
  args: BuildRouteArgs,
  mapboxToken: string,
  knownLandmarks: Landmark[],
): Promise<MCPToolResult> {
  if (args.waypoints.length < 2) {
    return { llmContent: JSON.stringify({ error: "Need at least 2 waypoints to build a route" }) };
  }

  // Normalise IDs: always ensure the "places_" prefix so landmark lookup works.
  // The LLM sometimes strips the prefix when it reads IDs from get_place_details responses.
  const normaliseId = (id: string) => (id.startsWith("places_") ? id : `places_${id}`);

  const waypoints = args.waypoints.map((w) => ({
    id: normaliseId(w.place_id),
    coordinates: w.coordinates,
    category: (w.category as Category) ?? "landmark",
    ...(w.visit_duration_minutes != null ? { visitDurationMinutes: w.visit_duration_minutes } : {}),
  }));

  const itinerary = await buildItinerary(
    waypoints,
    args.travel_mode ?? "walking",
    args.wish ?? "Custom tour",
    mapboxToken,
  );

  // Match each stop back to the full Landmark object so the widget can show thumbnails.
  // Some stops may not be in knownLandmarks if the LLM re-used a place from a
  // previous session — those will be silently filtered out (filter Boolean).
  const stopLandmarks = itinerary.stops
    .map((s) => knownLandmarks.find((l) => l.id === s.landmarkId))
    .filter((l): l is Landmark => l != null);

  return {
    llmContent: JSON.stringify({
      route_id:               itinerary.id,
      stops:                  itinerary.stops.length,
      total_duration_minutes: itinerary.totalDurationMinutes,
      total_distance_km:      itinerary.totalDistanceKm,
      travel_mode:            itinerary.travelMode,
      stop_names:             stopLandmarks.map((l) => l.name),
    }),
    itinerary,
    itineraryLandmarks: stopLandmarks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 6 — find_known_area
//
// PURPOSE: Convert a named Skopje neighbourhood or area into GPS coordinates
// and a suggested search radius. The LLM must call this FIRST whenever the
// user's request references a named location ("near the old bazaar", "in
// Karposh", "around city square") before doing any place search.
//
// This prevents the LLM from hallucinating coordinates. Instead of guessing
// where "old bazaar" is, the LLM calls this tool and gets back a precise
// lat/lng it can pass directly to search tools.
//
// IMPLEMENTATION: Pure static lookup — no API call, no cost, instantaneous.
// Matching strategy:
//   1. Exact lowercase match against SKOPJE_AREAS keys
//   2. Substring match in both directions (e.g. "čaršija" matches "carsija")
//   3. Fallback to the whole-city entry (15km radius) if nothing matches
//
// RETURN VALUE:
//   { area_name, latitude, longitude, radius_suggestion_meters }
// The LLM passes latitude/longitude directly to search tools and can also
// choose to override radius_suggestion_meters for larger or tighter searches.
// ─────────────────────────────────────────────────────────────────────────────

interface FindAreaArgs { area_name: string }

// Calls the Google Geocoding API when the area isn't in the static table.
// Derives a radius from the viewport bounds Google returns.
async function geocodeArea(
  areaName: string,
  apiKey: string,
): Promise<{ lat: number; lng: number; radius: number } | null> {
  try {
    const query = encodeURIComponent(`${areaName} skopje north macedonia`);
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results: Array<{
        geometry: {
          location: { lat: number; lng: number };
          viewport: {
            northeast: { lat: number; lng: number };
            southwest: { lat: number; lng: number };
          };
        };
      }>;
    };
    if (data.status !== "OK" || !data.results.length) return null;
    const { location, viewport } = data.results[0].geometry;
    // Derive radius from viewport diagonal (converted to meters)
    const latMeters = (viewport.northeast.lat - viewport.southwest.lat) * 111000;
    const lngMeters =
      (viewport.northeast.lng - viewport.southwest.lng) *
      111000 *
      Math.cos((location.lat * Math.PI) / 180);
    const radius = Math.min(15000, Math.max(500, Math.round(Math.max(latMeters, lngMeters) / 2)));
    return { lat: location.lat, lng: location.lng, radius };
  } catch {
    return null;
  }
}

async function execFindArea(args: FindAreaArgs, apiKey: string): Promise<MCPToolResult> {
  const key = (args.area_name ?? "").toLowerCase().trim();

  // 1. Exact match in static table
  let area = SKOPJE_AREAS[key];

  // 2. Fuzzy match (substring in either direction).
  // Skip the "skopje" catch-all key here — it would match any query containing "Skopje"
  // (e.g. "Stone Bridge Skopje") and return misleading city-wide coordinates.
  if (!area) {
    for (const [k, v] of Object.entries(SKOPJE_AREAS)) {
      if (k !== "skopje" && (key.includes(k) || k.includes(key))) { area = v; break; }
    }
  }

  // 3. Fall back to Google Geocoding API
  if (!area) {
    const geocoded = await geocodeArea(args.area_name, apiKey);
    if (geocoded) {
      return {
        llmContent: JSON.stringify({
          area_name:                args.area_name,
          latitude:                 geocoded.lat,
          longitude:                geocoded.lng,
          radius_suggestion_meters: geocoded.radius,
          source:                   "geocoded",
        }),
      };
    }
    // Geocoding also failed — tell the LLM so it can ask the user to clarify
    return {
      llmContent: JSON.stringify({
        error: `Could not find coordinates for "${args.area_name}". Ask the user to clarify which area they mean.`,
      }),
    };
  }

  return {
    llmContent: JSON.stringify({
      area_name:                args.area_name,
      latitude:                 area.lat,
      longitude:                area.lng,
      radius_suggestion_meters: area.radius,
      source:                   "static",
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// TOOL 7 — get_map_places
//
// PURPOSE: Returns every place currently visible on the map with its exact ID,
// name, category, and address. Call this tool FIRST whenever you need to
// reference a place the user mentioned by name but you don't have its ID —
// for example before calling get_place_details or build_route.
//
// No parameters needed. Returns the full list immediately from in-memory state
// (no API call, no cost, instantaneous).
// ─────────────────────────────────────────────────────────────────────────────

function execGetMapPlaces(knownLandmarks: Landmark[]): MCPToolResult {
  if (knownLandmarks.length === 0) {
    return { llmContent: JSON.stringify({ message: "No places on the map yet.", places: [] }) };
  }
  const places = knownLandmarks.map((l) => ({
    id: l.id,
    name: l.name,
    category: l.category,
    address: l.eyebrow ?? "",
    rating: l.rating,
  }));
  return { llmContent: JSON.stringify({ count: places.length, places }) };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP_TOOLS — the tool schema array sent to DeepSeek with every chat request
//
// THIS IS WHAT THE LLM READS. The `description` fields must be:
//   - Precise about WHEN to call the tool (the LLM picks based on this)
//   - Clear about what parameters to supply and what values are valid
//   - Actionable — the LLM should be able to make a correct call on first try
//
// Parameter `description` fields also matter: if the LLM doesn't know what
// value to put in a field it will hallucinate. Keep them concrete.
// ─────────────────────────────────────────────────────────────────────────────

export const MCP_TOOLS: GroqTool[] = [
  {
    type: "function",
    function: {
      name: "search_places_nearby",
      description:
        "Find places of a specific type near a location. Use for category-based searches: restaurants, museums, ATMs, parks, etc. " +
        "Returns a list of places with ratings, addresses and opening status.",
      parameters: {
        type: "object",
        properties: {
          included_types: {
            type: "array",
            items: { type: "string" },
            description:
              "Google place types to search for. Examples: ['restaurant'], ['museum','art_gallery'], ['atm'], ['park']. " +
              "Use the Skopje place types reference in the system prompt.",
          },
          latitude:     { type: "number", description: "Center latitude of the search area" },
          longitude:    { type: "number", description: "Center longitude of the search area" },
          radius_meters: {
            type: "number",
            description:
              "Hard search radius in meters. " +
              "500=single street/spot, 2000=neighbourhood, 5000=city center area, 15000=whole city",
          },
          max_results:  { type: "number", description: "Maximum results to return (1–20). Default 10. If the user asked for a specific count ('find me 3 restaurants', 'show 5 cafés'), use that exact number." },
          rank_by: {
            type: "string",
            enum: ["POPULARITY", "DISTANCE"],
            description: "POPULARITY (default) for best-rated results, DISTANCE for nearest-first",
          },
          group_label: {
            type: "string",
            description: "Short label for the map chip shown to the user, e.g. 'Top Restaurants', 'Museums'",
          },
          show_on_map: {
            type: "boolean",
            description: "Whether to show results as map pins. Default true. Set to false when searching internally during tour planning — results are still available via get_map_places but don't clutter the map with intermediate candidates.",
          },
        },
        required: ["included_types", "latitude", "longitude", "radius_meters"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_places_by_text",
      description:
        "Find places using a descriptive text query. Use for qualitative searches when the user describes a place: " +
        "'rooftop bar with view', 'traditional Macedonian tavern', 'quiet cafe with wifi', 'vegan food'. " +
        "Do NOT use this for simple category lookups — use search_places_nearby for those.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural language search query. Include location context if helpful, e.g. 'rooftop bar skopje' or 'traditional macedonian food old bazaar'",
          },
          latitude:     { type: "number", description: "Bias center latitude (soft — results outside are still possible)" },
          longitude:    { type: "number", description: "Bias center longitude" },
          radius_meters: { type: "number", description: "Soft bias radius in meters. Default 10000." },
          max_results:   { type: "number", description: "Maximum results to return (1–20). Default 8. If the user asked for a specific count ('find me 3 restaurants', 'show 5 cafés'), use that exact number." },
          group_label: {
            type: "string",
            description: "Short label for the map chip, e.g. 'Rooftop Bars', 'Vegan Food'",
          },
          show_on_map: {
            type: "boolean",
            description: "Whether to show results as map pins. Default true. Set to false when searching internally during tour planning — results are still available via get_map_places but don't clutter the map with intermediate candidates.",
          },
        },
        required: ["query", "latitude", "longitude"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_place_details",
      description:
        "Get full details for a specific place already on the map. " +
        "Use ONLY when the user asks a specific question about a place: " +
        "'Is it wheelchair accessible?', 'Does it accept credit cards?', 'Does it have outdoor seating?', 'What are the full hours?'. " +
        "Do NOT call this to get coordinates — coordinates are already in search results (lat/lng fields). " +
        "Do NOT call this during tour planning or route building.",
      parameters: {
        type: "object",
        properties: {
          place_id: {
            type: "string",
            description: "The exact place_id from a search result or from get_map_places. Never construct or guess an ID — if you don't have it, call get_map_places first.",
          },
        },
        required: ["place_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_route",
      description:
        "Build an optimised tour route from a list of places using real Mapbox road data. " +
        "Call this as the LAST step of tour planning, immediately after finding candidate places. " +
        "Pick the best-rated places by variety — do NOT filter by open_now, since hours may be outdated. " +
        "This is the ONLY way to create a visible route on the map.",
      parameters: {
        type: "object",
        properties: {
          waypoints: {
            type: "array",
            description: "The places to include in the tour, in any order (Mapbox will optimise the sequence)",
            items: {
              type: "object",
              properties: {
                place_id:    { type: "string", description: "Place ID from a search result (the 'id' field, e.g. 'places_ChIJ...'). Use the ID directly — do NOT call get_place_details just to obtain coordinates." },
                coordinates: {
                  type: "object",
                  description: "Use the lat/lng from the search result — they are included in every search response.",
                  properties: {
                    lat: { type: "number" },
                    lng: { type: "number" },
                  },
                  required: ["lat", "lng"],
                },
                category: {
                  type: "string",
                  description: "The place category: food, cafe, culture, landmark, outdoors, or shopping",
                },
                visit_duration_minutes: {
                  type: "number",
                  description: "How long the user wants to stay at this stop in minutes. Omit to use the default for its category (food=75, cafe=45, culture=60, landmark=30, outdoors=90, shopping=45). Set this if the user gave a custom duration during the clarifying questions.",
                },
              },
              required: ["place_id", "coordinates", "category"],
            },
          },
          travel_mode: {
            type: "string",
            enum: ["walking", "driving"],
            description: "walking for city-center tours, driving for spread-out routes or day trips",
          },
          optimize_order: {
            type: "boolean",
            description: "true = Mapbox reorders stops for minimum total travel time (recommended)",
          },
          wish: {
            type: "string",
            description: "One-line tour description shown as the route title, e.g. 'Morning tour of the Old Bazaar'",
          },
        },
        required: ["waypoints", "travel_mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_known_area",
      description:
        "Get GPS coordinates and a suggested search radius for a named AREA or NEIGHBOURHOOD (e.g. 'old bazaar', 'Karposh', 'city center', 'Vodno'). " +
        "Call this ONLY for area/district names — NOT for individual place names like 'Stone Bridge' or 'Casa Bar' (those are already in search results with coordinates). " +
        "NEVER guess or hallucinate coordinates for an area — call this tool instead. " +
        "Common Skopje areas resolve instantly; any other area name is geocoded automatically.",
      parameters: {
        type: "object",
        properties: {
          area_name: {
            type: "string",
            description:
              "A neighbourhood, district, or area name — e.g. 'old bazaar', 'city center', 'karposh', 'vodno'. " +
              "Do NOT pass individual place names here.",
          },
        },
        required: ["area_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_map_places",
      description:
        "Returns all places currently on the map with their exact IDs, names, categories, and addresses. " +
        "Call this FIRST whenever you need to reference a specific place the user mentioned by name but you don't have its place_id — " +
        "for example before calling get_place_details or when building a route from places already on the map. " +
        "No parameters needed.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// executeMCPTool — main dispatcher
//
// Called by ai.server.ts for each tool_call entry in the LLM's response.
// Dispatches to the appropriate executor function based on the tool name.
//
// All errors are caught and returned as { error: message } in llmContent so
// the LLM can gracefully handle failures (e.g. "I couldn't fetch the weather
// right now, let me suggest an itinerary anyway").
//
// knownLandmarks is the accumulated list of landmarks found in this chat session.
// It's passed to execBuildRoute so it can look up full Landmark objects for
// each route stop (the LLM only passes place IDs in the waypoints).
// ─────────────────────────────────────────────────────────────────────────────

export async function executeMCPTool(
  name: string,
  args: unknown,
  apiKey: string,
  mapboxToken: string,
  userLocation: Coordinates | null,
  knownLandmarks: Landmark[],
): Promise<MCPToolResult> {
  try {
    switch (name) {
      case "search_places_nearby":
        return await execSearchNearby(args as unknown as SearchNearbyArgs, apiKey, mapboxToken, userLocation);
      case "search_places_by_text":
        return await execSearchByText(args as unknown as SearchByTextArgs, apiKey, mapboxToken, userLocation);
      case "get_place_details":
        return await execGetPlaceDetails(args as unknown as GetDetailsArgs, apiKey);
      case "build_route":
        return await execBuildRoute(args as unknown as BuildRouteArgs, mapboxToken, knownLandmarks);
      case "find_known_area":
        return await execFindArea(args as unknown as FindAreaArgs, apiKey);
      case "get_map_places":
        return execGetMapPlaces(knownLandmarks);
      default:
        return { llmContent: JSON.stringify({ error: `Unknown tool: ${name}` }) };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { llmContent: JSON.stringify({ error: msg }) };
  }
}
