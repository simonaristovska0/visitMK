import type { Landmark, PlaceReview } from "../types";
import { withSatelliteFallback } from "./wikipedia.server";

// ── Types ─────────────────────────────────────────────────────────────────

interface PlaceResult {
  id: string;
  displayName?: { text: string };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  location?: { latitude: number; longitude: number };
  currentOpeningHours?: { openNow?: boolean };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  shortFormattedAddress?: string;
  editorialSummary?: { text: string };
  photos?: Array<{ name: string }>;
  reviews?: Array<{
    rating?: number;
    text?: { text: string };
    authorAttribution?: { displayName: string };
    relativePublishTimeDescription?: string;
  }>;
  nationalPhoneNumber?: string;
  websiteUri?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

const SKOPJE_CENTER = { latitude: 41.9973, longitude: 21.428 };

// Old Bazaar / Čaršija — café-dense area
const CARSIJA_CENTER = { latitude: 42.0010, longitude: 21.435 };

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

// Mask for OSM landmark enrichment — also fetches status to filter closed places
const PHOTO_ONLY_MASK = "places.id,places.photos,places.businessStatus";

const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "€",
  PRICE_LEVEL_MODERATE: "€€",
  PRICE_LEVEL_EXPENSIVE: "€€€",
  PRICE_LEVEL_VERY_EXPENSIVE: "€€€€",
};

// ── In-memory cache ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000;
const ATTRACTIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let nearbyCache: { ts: number; data: Landmark[] } | null = null;
let attractionsCache: { ts: number; data: Landmark[] } | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function walkMins(lat: number, lng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - SKOPJE_CENTER.latitude);
  const dLng = toRad(lng - SKOPJE_CENTER.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(SKOPJE_CENTER.latitude)) *
      Math.cos(toRad(lat)) *
      Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.ceil(dist / 83.3)); // 5 km/h walking = 83.3 m/min
}

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

// ── Photo URL resolution ───────────────────────────────────────────────────

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

async function withPhotos(
  places: PlaceResult[],
  landmarks: Landmark[],
  apiKey: string,
): Promise<Landmark[]> {
  const results = await Promise.allSettled(
    places.map((p) => {
      const name = p.photos?.[0]?.name;
      return name ? resolvePhotoUrl(name, apiKey) : Promise.resolve("");
    }),
  );
  return landmarks.map((lm, i) => {
    const r = results[i];
    const url = r?.status === "fulfilled" ? r.value : "";
    return url ? { ...lm, heroImage: url } : lm;
  });
}

// ── Mapping ────────────────────────────────────────────────────────────────

function mapToLandmark(p: PlaceResult, category: import("../types").Category = "food"): Landmark {
  const lat = p.location?.latitude ?? SKOPJE_CENTER.latitude;
  const lng = p.location?.longitude ?? SKOPJE_CENTER.longitude;
  const openNow = p.currentOpeningHours?.openNow ?? false;
  const weekly = p.regularOpeningHours?.weekdayDescriptions ?? [];

  // Extract open/close from first weekday description or fall back to defaults
  const todayHours = weekly[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] ?? "";
  const timeMatch = todayHours.match(/(\d{1,2}:\d{2}\s?[AP]M)\s*[–-]\s*(\d{1,2}:\d{2}\s?[AP]M)/i);

  return {
    id: `places_${p.id}`,
    name: p.displayName?.text ?? "Place",
    category,
    coordinates: { lat, lng },
    rating: Math.round((p.rating ?? 0) * 10) / 10,
    reviewCount: p.userRatingCount ?? 0,
    priceMKD: 0,
    priceLabel: PRICE_LABEL[p.priceLevel ?? ""],
    openingHours: {
      open: timeMatch?.[1] ?? "09:00",
      close: timeMatch?.[2] ?? "23:00",
      openNow,
    },
    weeklyHours: weekly.length ? weekly : undefined,
    walkTimeMinutes: walkMins(lat, lng),
    heroImage: "",
    eyebrow: p.shortFormattedAddress,
    history: p.editorialSummary?.text ?? "",
    practicalInfo: weekly.join("\n"),
    phone: p.nationalPhoneNumber,
    website: p.websiteUri,
    reviews: mapReviews(p.reviews),
  };
}

// ── API helper ─────────────────────────────────────────────────────────────

async function placesPost(
  endpoint: string,
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

// ── Public exports ─────────────────────────────────────────────────────────

/** Top food places near Skopje — two geographic areas, three types. Cached 1h. */
export async function getTopRestaurantsNearSkopje(apiKey: string): Promise<Landmark[]> {
  const now = Date.now();
  if (nearbyCache && now - nearbyCache.ts < CACHE_TTL_MS) return nearbyCache.data;

  const area = (center: typeof SKOPJE_CENTER, r: number) => ({
    locationRestriction: { circle: { center, radius: r } },
  });

  // 6 parallel calls: restaurants + cafes + bars × 2 geographic areas
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

  const tagged: Array<{ place: PlaceResult; category: "food" | "cafe" }> = [
    ...[...restaurantsCenter, ...restaurantsCarsija].map((p) => ({ place: p, category: "food" as const })),
    ...[...cafesCenter, ...cafesCarsija].map((p) => ({ place: p, category: "cafe" as const })),
    ...barsCenter.map((p) => ({ place: p, category: "food" as const })),
  ];

  const seen = new Set<string>();
  const merged = tagged.filter(({ place }) => {
    if (seen.has(place.id)) return false;
    seen.add(place.id);
    if (place.businessStatus === "CLOSED_PERMANENTLY") return false;
    return (place.rating ?? 0) >= 3.0;
  });
  merged.sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0));

  const places = merged.map(({ place }) => place);
  const landmarks = merged.map(({ place, category }) => mapToLandmark(place, category));
  const withPhotoResolved = await withPhotos(places, landmarks, apiKey);
  const token = process.env.VITE_MAPBOX_TOKEN ?? "";
  const data = withSatelliteFallback(withPhotoResolved, token);

  nearbyCache = { ts: now, data };
  return data;
}

/**
 * For each landmark with no heroImage, does a tight Google Places text search
 * by name + coordinates and fills in the first photo result.
 * Called by osm.server.ts after Wikidata enrichment, before satellite fallback.
 */
export async function enrichWithGooglePhotos(
  landmarks: Landmark[],
  apiKey: string,
): Promise<Landmark[]> {
  // Run for ALL landmarks so we can also catch permanently-closed OSM entries
  const results = await Promise.allSettled(
    landmarks.map(async (lm) => {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": PHOTO_ONLY_MASK,
          },
          body: JSON.stringify({
            textQuery: lm.name,
            maxResultCount: 1,
            locationBias: {
              circle: {
                center: { latitude: lm.coordinates.lat, longitude: lm.coordinates.lng },
                radius: 300,
              },
            },
          }),
        });
        if (!res.ok) return { id: lm.id, photoUrl: "", closed: false };
        const data = await res.json();
        const place = data.places?.[0];
        const closed = place?.businessStatus === "CLOSED_PERMANENTLY";
        if (closed) return { id: lm.id, photoUrl: "", closed: true };
        const photoName: string | undefined = place?.photos?.[0]?.name;
        const photoUrl =
          photoName && !lm.heroImage ? await resolvePhotoUrl(photoName, apiKey) : "";
        return { id: lm.id, photoUrl, closed: false };
      } catch {
        return { id: lm.id, photoUrl: "", closed: false };
      }
    }),
  );

  const photoMap = new Map<string, string>();
  const closedIds = new Set<string>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    if (r.value.closed) { closedIds.add(r.value.id); continue; }
    if (r.value.photoUrl) photoMap.set(r.value.id, r.value.photoUrl);
  }

  return landmarks
    .filter((lm) => !closedIds.has(lm.id))
    .map((lm) => {
      if (lm.heroImage) return lm;
      const photoUrl = photoMap.get(lm.id);
      return photoUrl ? { ...lm, heroImage: photoUrl } : lm;
    });
}

/**
 * Tourist attractions, museums, parks, culture, and shopping near Skopje —
 * sourced entirely from Google Places so businessStatus filters out
 * permanently closed venues automatically. Cached 6h.
 */
export async function getTopAttractionsNearSkopje(apiKey: string): Promise<Landmark[]> {
  const now = Date.now();
  if (attractionsCache && now - attractionsCache.ts < ATTRACTIONS_CACHE_TTL_MS) {
    return attractionsCache.data;
  }

  const at = (center: typeof SKOPJE_CENTER, r: number) => ({
    locationRestriction: { circle: { center, radius: r } },
  });
  const SOUTH = { latitude: 41.975, longitude: 21.435 };

  // Use allSettled so one bad call never kills the rest
  type TaggedPlace = { place: PlaceResult; category: import("../types").Category };

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
      return [];
    }
  }

  const batches = await Promise.all([
    safe(["tourist_attraction"],           SKOPJE_CENTER,  8000,  "landmark"),
    safe(["tourist_attraction"],           CARSIJA_CENTER, 4000,  "landmark"),
    safe(["tourist_attraction"],           SOUTH,          6000,  "landmark"),
    safe(["museum", "art_gallery"],        SKOPJE_CENTER,  10000, "culture"),
    safe(["museum", "art_gallery"],        CARSIJA_CENTER, 4000,  "culture"),
    safe(["church", "mosque"],             SKOPJE_CENTER,  8000,  "culture"),
    safe(["church", "mosque"],             CARSIJA_CENTER, 4000,  "culture"),
    safe(["synagogue", "hindu_temple"],    SKOPJE_CENTER,  10000, "culture"),
    safe(["park", "botanical_garden"],     SKOPJE_CENTER,  12000, "outdoors"),
    safe(["zoo", "amusement_park"],        SKOPJE_CENTER,  12000, "outdoors"),
    safe(["shopping_mall"],                SKOPJE_CENTER,  12000, "shopping"),
    safe(["shopping_mall"],                SOUTH,          6000,  "shopping"),
  ]);

  const tagged: TaggedPlace[] = batches.flat();

  const seen = new Set<string>();
  const merged = tagged.filter(({ place }) => {
    if (seen.has(place.id)) return false;
    seen.add(place.id);
    return place.businessStatus !== "CLOSED_PERMANENTLY";
  });

  const places = merged.map(({ place }) => place);
  const lms = merged.map(({ place, category }) => mapToLandmark(place, category));
  const withPhotoResolved = await withPhotos(places, lms, apiKey);
  const token = process.env.VITE_MAPBOX_TOKEN ?? "";
  const data = withSatelliteFallback(withPhotoResolved, token);

  attractionsCache = { ts: now, data };
  return data;
}

/** Free-text search — live, no cache. */
export async function searchRestaurantsByText(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<Landmark[]> {
  const places = await placesPost(
    "searchText",
    {
      textQuery: query,
      maxResultCount: maxResults,
      locationBias: { circle: { center: SKOPJE_CENTER, radius: 15000 } },
    },
    apiKey,
  );
  const filtered = places
    .filter((p) => p.rating != null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const withPhotoResolved = await withPhotos(filtered, filtered.map((p) => mapToLandmark(p, "food")), apiKey);
  return withSatelliteFallback(withPhotoResolved, process.env.VITE_MAPBOX_TOKEN ?? "");
}
