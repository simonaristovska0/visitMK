// ─────────────────────────────────────────────────────────────────────────────
// places.server.ts
//
// SERVER-ONLY file. Never imported by the browser.
// All functions here talk to the Google Places API (New) to fetch restaurants,
// cafés, tourist attractions, museums, parks, etc. near Skopje.
//
// WHO CALLS THIS FILE:
//   - places.functions.ts  → exposes getTopAttractions() and getTopRestaurants()
//                            as TanStack server functions that the UI calls
//   - osm.server.ts        → calls enrichWithGooglePhotos() to add photos to
//                            landmarks that were fetched from OpenStreetMap
// ─────────────────────────────────────────────────────────────────────────────

import type { Landmark, PlaceReview } from "../types";
import { withSatelliteFallback } from "./wikipedia.server";

// ── Types ─────────────────────────────────────────────────────────────────────
//
// PlaceResult is the shape of a single place object returned by Google Places API.
// Google returns many more fields than this — we only declare the ones we use.
// Every field is optional (?) because Google may omit any of them.

interface PlaceResult {
  id: string;                                          // Google's internal place ID, e.g. "ChIJ..."
  displayName?: { text: string };                      // Human-readable name, e.g. "Stone Bridge"
  rating?: number;                                     // Average star rating, e.g. 4.6
  userRatingCount?: number;                            // How many people rated it, e.g. 3421
  priceLevel?: string;                                 // e.g. "PRICE_LEVEL_MODERATE"
  businessStatus?: string;                             // "OPERATIONAL" or "CLOSED_PERMANENTLY"
  location?: { latitude: number; longitude: number };  // GPS coordinates
  currentOpeningHours?: { openNow?: boolean };         // Is it open right now?
  regularOpeningHours?: { weekdayDescriptions?: string[] }; // e.g. ["Monday: 9:00 AM – 10:00 PM", ...]
  shortFormattedAddress?: string;                      // e.g. "Ploštad Makedonija, Skopje"
  editorialSummary?: { text: string };                 // Short editorial description from Google
  photos?: Array<{ name: string }>;                    // Photo resource names, used to build photo URLs
  reviews?: Array<{
    rating?: number;
    text?: { text: string };
    authorAttribution?: { displayName: string };
    relativePublishTimeDescription?: string;           // e.g. "3 months ago"
  }>;
  nationalPhoneNumber?: string;
  websiteUri?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// The geographic center of Skopje — used as the origin for walking time calculations
// and as the default center for most "nearby" searches.
const SKOPJE_CENTER = { latitude: 41.9973, longitude: 21.428 };

// The Old Bazaar (Čaršija) area — a separate geographic point used for searches
// in that specific neighbourhood, which is very dense with cafés and restaurants.
const CARSIJA_CENTER = { latitude: 42.0010, longitude: 21.435 };

// FIELD_MASK tells Google which fields to include in the response.
// Google Places API (New) bills per field group — requesting fewer fields = lower cost.
// This mask is used for all full-detail requests (restaurants, attractions).
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.businessStatus",
  "places.location",
  "places.currentOpeningHours",
  "places.regularOpeningHours",
  "places.shortFormattedAddress",
  "places.editorialSummary",
  "places.photos",
  "places.reviews",
  "places.nationalPhoneNumber",
  "places.websiteUri",
].join(",");

// A cheaper, minimal mask used only when we just want to check for a photo
// and whether the place is still open. Used in enrichWithGooglePhotos().
const PHOTO_ONLY_MASK = "places.id,places.photos,places.businessStatus";

// Maps Google's price level enum strings to simple euro-sign labels
// shown in the UI on landmark cards.
const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "€",
  PRICE_LEVEL_MODERATE: "€€",
  PRICE_LEVEL_EXPENSIVE: "€€€",
  PRICE_LEVEL_VERY_EXPENSIVE: "€€€€",
};

// ── In-memory cache ───────────────────────────────────────────────────────────
//
// Because these API calls are expensive (Google bills per request), we cache
// the results in server memory so the same data isn't fetched on every page load.
// The cache lives for the duration the server process is running.
// If the server restarts (e.g. redeploy), the cache is cleared and data is re-fetched.

const CACHE_TTL_MS = 60 * 60 * 1000;              // Restaurants: 1 hour
const ATTRACTIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // Attractions: 6 hours (changes less often)

// These are module-level variables — they persist between requests on the same server instance.
let nearbyCache: { ts: number; data: Landmark[] } | null = null;
let attractionsCache: { ts: number; data: Landmark[] } | null = null;

// ── Helper functions ──────────────────────────────────────────────────────────

// Calculates how many minutes it would take to WALK from Skopje center to a given point.
// Uses the Haversine formula to get the straight-line distance in meters,
// then divides by 83.3 m/min (= 5 km/h walking speed).
// Result is shown on landmark cards as "~12 min walk".
function walkMins(lat: number, lng: number): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - SKOPJE_CENTER.latitude);
  const dLng = toRad(lng - SKOPJE_CENTER.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(SKOPJE_CENTER.latitude)) *
      Math.cos(toRad(lat)) *
      Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.ceil(dist / 83.3)); // minimum 1 minute
}

// Converts the raw Google reviews array into our app's PlaceReview shape.
// Filters out reviews that have no text (rating-only reviews).
function mapReviews(raw: PlaceResult["reviews"]): PlaceReview[] {
  if (!raw?.length) return [];
  return raw
    .filter((r) => r.text?.text)
    .map((r) => ({
      author: r.authorAttribution?.displayName ?? "Google User",
      rating: r.rating ?? 0,
      text: r.text!.text,
      relativeTime: r.relativePublishTimeDescription ?? "",
    }));
}

// ── Photo URL resolution ──────────────────────────────────────────────────────

// Google Places API returns photo "names" (resource paths like "places/ChIJ.../photos/AUc...")
// not actual image URLs. You have to make a second API call to resolve each name into a URL.
//
// API CALL: GET https://places.googleapis.com/v1/{photoName}/media
//   - maxWidthPx=800     → resize to max 800px wide
//   - skipHttpRedirect=true → return a JSON body with the URL instead of a redirect
//   - key=...            → API key in query param (this endpoint doesn't use the header)
//
// Returns the actual CDN image URL, or "" if it fails.
// Called inside withPhotos() for every place in a result batch.
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

// Takes a batch of PlaceResult objects and their corresponding Landmark objects
// (same index = same place), resolves the first photo for each place in parallel,
// and merges the photo URLs back into the landmarks.
//
// Uses Promise.allSettled so a single photo failure doesn't crash the whole batch.
// If a photo fails, that landmark just keeps heroImage: "".
async function withPhotos(
  places: PlaceResult[],
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
    const url = r?.status === "fulfilled" ? r.value : "";
    return url ? { ...lm, heroImage: url } : lm;
  });
}

// ── Mapping ───────────────────────────────────────────────────────────────────

// Converts a raw Google PlaceResult object into our app's internal Landmark shape.
// This is the "translation layer" between Google's data format and what the UI expects.
//
// Notable transformations:
//   - id: prefixed with "places_" to avoid collisions with OSM landmark IDs
//   - openingHours.open/close: parsed from Google's weekday description string
//     e.g. "Monday: 9:00 AM – 10:00 PM" → { open: "9:00 AM", close: "10:00 PM" }
//   - walkTimeMinutes: computed via haversine from Skopje center (not actual routing)
//   - heroImage: always starts empty — filled in later by withPhotos()
//   - priceLabel: converted from enum string to "€€" style label
function mapToLandmark(p: PlaceResult, category: import("../types").Category = "food"): Landmark {
  const lat = p.location?.latitude ?? SKOPJE_CENTER.latitude;
  const lng = p.location?.longitude ?? SKOPJE_CENTER.longitude;
  const openNow = p.currentOpeningHours?.openNow ?? false;
  const weekly = p.regularOpeningHours?.weekdayDescriptions ?? [];

  // Google's weekday array is 0=Monday...6=Sunday, but JS getDay() is 0=Sunday...6=Saturday.
  // This converts JS day index to Google's index.
  const todayHours = weekly[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] ?? "";
  const timeMatch = todayHours.match(/(\d{1,2}:\d{2}\s?[AP]M)\s*[–-]\s*(\d{1,2}:\d{2}\s?[AP]M)/i);

  return {
    id: `places_${p.id}`,
    name: p.displayName?.text ?? "Place",
    category,
    coordinates: { lat, lng },
    rating: Math.round((p.rating ?? 0) * 10) / 10,   // round to 1 decimal, e.g. 4.6
    reviewCount: p.userRatingCount ?? 0,
    priceMKD: 0,                                       // Google doesn't give prices in MKD
    priceLabel: PRICE_LABEL[p.priceLevel ?? ""],
    openingHours: {
      open: timeMatch?.[1] ?? "09:00",
      close: timeMatch?.[2] ?? "23:00",
      openNow,
    },
    weeklyHours: weekly.length ? weekly : undefined,   // full 7-day schedule for the detail panel
    walkTimeMinutes: walkMins(lat, lng),
    heroImage: "",                                     // filled in by withPhotos() after this
    eyebrow: p.shortFormattedAddress,                  // shown as subtitle on cards
    history: p.editorialSummary?.text ?? "",
    practicalInfo: weekly.join("\n"),
    phone: p.nationalPhoneNumber,
    website: p.websiteUri,
    reviews: mapReviews(p.reviews),
  };
}

// ── Core API helper ───────────────────────────────────────────────────────────

// Sends a POST request to any Google Places API (New) endpoint.
// The Google Places API (New) uses POST for all search operations, not GET.
//
// API CALL: POST https://places.googleapis.com/v1/places:{endpoint}
//   Headers:
//     X-Goog-Api-Key   → the API key (server-side only, never sent to the browser)
//     X-Goog-FieldMask → tells Google which fields to return (controls billing cost)
//   Body: JSON with search parameters (location, types, etc.)
//
// Returns the "places" array from the response, or throws if the request fails.
// Called by: getTopRestaurantsNearSkopje, getTopAttractionsNearSkopje, searchRestaurantsByText
async function placesPost(
  endpoint: string,  // e.g. "searchNearby" or "searchText"
  body: object,
  apiKey: string,
): Promise<PlaceResult[]> {
  const res = await fetch(`https://places.googleapis.com/v1/places:${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Places API ${endpoint}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.places ?? []) as PlaceResult[];
}

// ── Public exports ────────────────────────────────────────────────────────────
//
// These three functions are the ones called from outside this file.

// ─────────────────────────────────────────────────────────────────────────────
// getTopRestaurantsNearSkopje
//
// CALLED BY: places.functions.ts → getTopRestaurants() server fn
//            → ExploreView.tsx uses useQuery(["top-restaurants"]) to call it
//
// Fetches top restaurants, cafés, and bars near Skopje. Makes 5 parallel API
// calls across 2 geographic areas (city center + Old Bazaar) to ensure good
// coverage of both tourist-facing and local places.
//
// Result is cached for 1 hour. On a cache hit, no API calls are made at all.
// ─────────────────────────────────────────────────────────────────────────────
export async function getTopRestaurantsNearSkopje(apiKey: string): Promise<Landmark[]> {
  const now = Date.now();
  // Return cached data if it's less than 1 hour old
  if (nearbyCache && now - nearbyCache.ts < CACHE_TTL_MS) return nearbyCache.data;

  // Helper that builds the locationRestriction object for a circular area
  const area = (center: typeof SKOPJE_CENTER, r: number) => ({
    locationRestriction: { circle: { center, radius: r } },
  });

  // 5 parallel API calls — all fire at the same time, we wait for all to finish.
  // Each call is: POST /places:searchNearby with different types and locations.
  //   Call 1: restaurants in 6km radius of city center (up to 20 results)
  //   Call 2: restaurants in 3km radius of Old Bazaar (up to 20 results)
  //   Call 3: cafés, coffee shops, bakeries in 6km of city center
  //   Call 4: cafés, coffee shops in 3km of Old Bazaar
  //   Call 5: bars and wine bars in 6km of city center
  const [
    restaurantsCenter, restaurantsCarsija,
    cafesCenter, cafesCarsija,
    barsCenter,
  ] = await Promise.all([
    placesPost("searchNearby", { includedTypes: ["restaurant"], maxResultCount: 20, rankPreference: "POPULARITY", ...area(SKOPJE_CENTER, 6000) }, apiKey),
    placesPost("searchNearby", { includedTypes: ["restaurant"], maxResultCount: 20, rankPreference: "POPULARITY", ...area(CARSIJA_CENTER, 3000) }, apiKey),
    placesPost("searchNearby", { includedTypes: ["cafe", "coffee_shop", "bakery"], maxResultCount: 20, rankPreference: "POPULARITY", ...area(SKOPJE_CENTER, 6000) }, apiKey),
    placesPost("searchNearby", { includedTypes: ["cafe", "coffee_shop"], maxResultCount: 20, rankPreference: "POPULARITY", ...area(CARSIJA_CENTER, 3000) }, apiKey),
    placesPost("searchNearby", { includedTypes: ["bar", "wine_bar"], maxResultCount: 20, rankPreference: "POPULARITY", ...area(SKOPJE_CENTER, 6000) }, apiKey),
  ]);

  // Tag each place with the category we want to show it as in the UI
  const tagged: Array<{ place: PlaceResult; category: "food" | "cafe" }> = [
    ...[...restaurantsCenter, ...restaurantsCarsija].map((p) => ({ place: p, category: "food" as const })),
    ...[...cafesCenter, ...cafesCarsija].map((p) => ({ place: p, category: "cafe" as const })),
    ...barsCenter.map((p) => ({ place: p, category: "food" as const })),
  ];

  // Deduplicate (same place can appear in multiple search radius overlaps),
  // remove permanently closed places, and filter out anything below 3 stars.
  const seen = new Set<string>();
  const merged = tagged.filter(({ place }) => {
    if (seen.has(place.id)) return false;     // already in list from another search
    seen.add(place.id);
    if (place.businessStatus === "CLOSED_PERMANENTLY") return false;
    return (place.rating ?? 0) >= 3.0;        // skip very low-rated places
  });
  // Sort by rating descending so the best places appear first
  merged.sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0));

  // Convert to our Landmark shape, then resolve photos, then add satellite fallback
  const places = merged.map(({ place }) => place);
  const landmarks = merged.map(({ place, category }) => mapToLandmark(place, category));
  const withPhotoResolved = await withPhotos(places, landmarks, apiKey); // photo API calls happen here
  const token = process.env.VITE_MAPBOX_TOKEN ?? "";
  const data = withSatelliteFallback(withPhotoResolved, token); // any landmark still missing a photo gets a Mapbox satellite image

  nearbyCache = { ts: now, data }; // store in cache for next request
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// enrichWithGooglePhotos
//
// CALLED BY: osm.server.ts → getLandmarksByCity()
//            (after Wikipedia and Wikidata enrichment, before satellite fallback)
//
// Takes a list of landmarks that came from OpenStreetMap (not Google) and tries
// to find a Google Places photo for each one. Also uses this as an opportunity
// to detect permanently-closed places and remove them from the list.
//
// For each landmark it makes ONE API call:
//   POST /places:searchText
//     - searches by the landmark's name as a text query
//     - biased towards a 300m circle around the landmark's known coordinates
//     - uses PHOTO_ONLY_MASK (cheap) — only asks for id, photos, businessStatus
//
// If a photo is found, it then calls resolvePhotoUrl() to get the actual URL.
// ─────────────────────────────────────────────────────────────────────────────
export async function enrichWithGooglePhotos(
  landmarks: Landmark[],
  apiKey: string,
): Promise<Landmark[]> {
  // Run all landmark lookups in parallel with Promise.allSettled.
  // allSettled means if one fails, the rest still complete (unlike Promise.all which aborts on any failure).
  const results = await Promise.allSettled(
    landmarks.map(async (lm) => {
      try {
        // API CALL: POST https://places.googleapis.com/v1/places:searchText
        // Searches for the landmark by name, biased near its coordinates.
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": PHOTO_ONLY_MASK, // only id + photos + businessStatus (cheaper)
          },
          body: JSON.stringify({
            textQuery: lm.name,       // e.g. "Stone Bridge"
            maxResultCount: 1,        // we only want the top match
            locationBias: {
              circle: {
                center: { latitude: lm.coordinates.lat, longitude: lm.coordinates.lng },
                radius: 300,          // 300m — tight bias so we get the right place, not a namesake elsewhere
              },
            },
          }),
        });
        if (!res.ok) return { id: lm.id, photoUrl: "", closed: false };
        const data = await res.json();
        const place = data.places?.[0];

        // If Google says the place is permanently closed, mark it so we can remove it
        const closed = place?.businessStatus === "CLOSED_PERMANENTLY";
        if (closed) return { id: lm.id, photoUrl: "", closed: true };

        // If we got a photo name and the landmark doesn't already have a photo, resolve it
        const photoName: string | undefined = place?.photos?.[0]?.name;
        const photoUrl =
          photoName && !lm.heroImage ? await resolvePhotoUrl(photoName, apiKey) : "";
        return { id: lm.id, photoUrl, closed: false };
      } catch {
        return { id: lm.id, photoUrl: "", closed: false }; // silently skip failures
      }
    }),
  );

  // Build lookup maps from the results
  const photoMap = new Map<string, string>();   // landmarkId → photoUrl
  const closedIds = new Set<string>();           // landmark IDs that are permanently closed
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    if (r.value.closed) { closedIds.add(r.value.id); continue; }
    if (r.value.photoUrl) photoMap.set(r.value.id, r.value.photoUrl);
  }

  // Filter out closed places entirely, then merge photos into remaining landmarks
  return landmarks
    .filter((lm) => !closedIds.has(lm.id))
    .map((lm) => {
      if (lm.heroImage) return lm; // already has a photo (from Wikipedia/Wikidata), don't overwrite
      const photoUrl = photoMap.get(lm.id);
      return photoUrl ? { ...lm, heroImage: photoUrl } : lm;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// getTopAttractionsNearSkopje
//
// CALLED BY: places.functions.ts → getTopAttractions() server fn
//            → PlanView.tsx uses useQuery(["top-attractions"]) to call it
//            → ExploreView.tsx uses useQuery(["top-attractions"]) to call it
//              (both share the same React Query cache key, so only one fetch happens)
//
// Fetches tourist attractions, museums, churches, mosques, parks, and malls
// near Skopje. Makes 12 parallel API calls across different place types and
// geographic centers to get comprehensive coverage.
//
// Result is cached for 6 hours (longer than restaurants because attractions
// change less frequently).
// ─────────────────────────────────────────────────────────────────────────────
export async function getTopAttractionsNearSkopje(apiKey: string): Promise<Landmark[]> {
  const now = Date.now();
  // Return cached data if it's less than 6 hours old
  if (attractionsCache && now - attractionsCache.ts < ATTRACTIONS_CACHE_TTL_MS) {
    return attractionsCache.data;
  }

  const at = (center: typeof SKOPJE_CENTER, r: number) => ({
    locationRestriction: { circle: { center, radius: r } },
  });
  // A third geographic center — south of the city, covers areas like Skopje Aqueduct
  const SOUTH = { latitude: 41.975, longitude: 21.435 };

  type TaggedPlace = { place: PlaceResult; category: import("../types").Category };

  // Wrapper around placesPost that catches errors and returns [] instead of throwing.
  // This way if one of the 12 calls fails (e.g. a Google API quota error for that type),
  // the other 11 calls still complete and we get partial results.
  async function safe(
    types: string[],
    center: typeof SKOPJE_CENTER,
    radius: number,
    category: import("../types").Category,
  ): Promise<TaggedPlace[]> {
    try {
      const results = await placesPost("searchNearby", {
        includedTypes: types,
        maxResultCount: 20,
        rankPreference: "POPULARITY",
        ...at(center, radius),
      }, apiKey);
      return results.map((p) => ({ place: p, category }));
    } catch {
      return []; // silently swallow the error, return no results for this batch
    }
  }

  // 12 parallel API calls — all POST /places:searchNearby with different parameters.
  // Layout: safe(googleTypes, center, radiusMeters, ourCategory)
  const batches = await Promise.all([
    safe(["tourist_attraction"],           SKOPJE_CENTER,  8000,  "landmark"),  // general attractions, city center
    safe(["tourist_attraction"],           CARSIJA_CENTER, 4000,  "landmark"),  // general attractions, Old Bazaar
    safe(["tourist_attraction"],           SOUTH,          6000,  "landmark"),  // general attractions, south area
    safe(["museum", "art_gallery"],        SKOPJE_CENTER,  10000, "culture"),   // museums and galleries
    safe(["museum", "art_gallery"],        CARSIJA_CENTER, 4000,  "culture"),   // museums in Old Bazaar
    safe(["church", "mosque"],             SKOPJE_CENTER,  8000,  "culture"),   // religious sites, center
    safe(["church", "mosque"],             CARSIJA_CENTER, 4000,  "culture"),   // religious sites, Old Bazaar
    safe(["synagogue", "hindu_temple"],    SKOPJE_CENTER,  10000, "culture"),   // other religious sites
    safe(["park", "botanical_garden"],     SKOPJE_CENTER,  12000, "outdoors"),  // parks and gardens
    safe(["zoo", "amusement_park"],        SKOPJE_CENTER,  12000, "outdoors"),  // family attractions
    safe(["shopping_mall"],                SKOPJE_CENTER,  12000, "shopping"),  // shopping malls, center
    safe(["shopping_mall"],                SOUTH,          6000,  "shopping"),  // shopping malls, south
  ]);

  // Flatten all 12 arrays into one
  const tagged: TaggedPlace[] = batches.flat();

  // Deduplicate (same place can appear in multiple overlapping searches)
  // and remove permanently closed places.
  const seen = new Set<string>();
  const merged = tagged.filter(({ place }) => {
    if (seen.has(place.id)) return false;
    seen.add(place.id);
    return place.businessStatus !== "CLOSED_PERMANENTLY";
  });
  // Note: no minimum rating filter here (unlike restaurants) — even lesser-known
  // landmarks are worth showing in the attractions list.

  // Convert to Landmark shape, resolve photos, add satellite fallback for missing photos
  const places = merged.map(({ place }) => place);
  const lms = merged.map(({ place, category }) => mapToLandmark(place, category));
  const withPhotoResolved = await withPhotos(places, lms, apiKey); // photo API calls happen here
  const token = process.env.VITE_MAPBOX_TOKEN ?? "";
  const data = withSatelliteFallback(withPhotoResolved, token);

  attractionsCache = { ts: now, data }; // store in cache
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// searchRestaurantsByText
//
// CALLED BY: places.functions.ts → searchRestaurants() server fn
//            (currently available as a server fn but not yet wired to any UI component)
//
// Free-text search for restaurants — takes a user-typed query like "italian restaurant"
// and searches Google Places for matching places near Skopje.
// NOT cached — every call goes live to the API.
// ─────────────────────────────────────────────────────────────────────────────
export async function searchRestaurantsByText(
  query: string,       // e.g. "italian pizza" or "traditional macedonian food"
  maxResults: number,  // how many results to return (max 20 per Google's limit)
  apiKey: string,
): Promise<Landmark[]> {
  // API CALL: POST /places:searchText
  // Unlike searchNearby (which filters by place type), searchText accepts free-form text.
  // locationBias is a soft preference — results outside the circle can still appear.
  const places = await placesPost(
    "searchText",
    {
      textQuery: query,
      maxResultCount: maxResults,
      locationBias: { circle: { center: SKOPJE_CENTER, radius: 15000 } }, // 15km bias around Skopje
    },
    apiKey,
  );

  // Filter out places with no rating (likely spam or incomplete listings),
  // then sort by rating descending.
  const filtered = places
    .filter((p) => p.rating != null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  const withPhotoResolved = await withPhotos(filtered, filtered.map((p) => mapToLandmark(p, "food")), apiKey);
  return withSatelliteFallback(withPhotoResolved, process.env.VITE_MAPBOX_TOKEN ?? "");
}
