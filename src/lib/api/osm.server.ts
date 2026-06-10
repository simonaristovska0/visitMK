// ─────────────────────────────────────────────────────────────────────────────
// osm.server.ts
//
// SERVER-ONLY file. Never imported by the browser.
//
// OSM = OpenStreetMap — a free, community-maintained map of the world.
// This file fetches tourist landmarks from the Overpass API, which is a
// query interface on top of OpenStreetMap data.
//
// Unlike Google Places (which is a commercial product with pricing per call),
// OpenStreetMap/Overpass is completely free. The trade-off is that the data
// is less polished — no photos, no ratings, no editorial summaries.
// That's why after fetching from OSM, this file runs several enrichment passes
// to fill in those gaps from Wikipedia, Wikidata, and Google Photos.
//
// WHO CALLS THIS FILE:
//   - osm.functions.ts → getLandmarks() server fn → calls getLandmarksByCity() here
//     (currently not wired to any UI component — defined but unused in the UI)
//
// PIPELINE (what happens when getLandmarksByCity() is called):
//   1. Query Overpass API → raw OSM elements (nodes/ways with tags)
//   2. Convert each element to our Landmark shape (osmToLandmark)
//   3. Deduplicate (same place can appear as both a node and a way in OSM)
//   4. enrichWithWikipedia()    → add description text + thumbnail from Wikipedia
//   5. enrichWithWikidata()     → add main image from Wikidata P18 property
//   6. enrichWithGooglePhotos() → add Google photo for anything still missing one
//                                 also removes permanently-closed places
//   7. withSatelliteFallback()  → use Mapbox satellite image as last resort
//   8. Cache the result for 6 hours
// ─────────────────────────────────────────────────────────────────────────────

import type { Category, Landmark } from "../types";
import { enrichWithWikipedia, enrichWithWikidata, withSatelliteFallback } from "./wikipedia.server";
import { enrichWithGooglePhotos } from "./places.server";

// ── Geographic bounding boxes ─────────────────────────────────────────────────
//
// The Overpass API works by querying within a bounding box (a rectangle on the map).
// Format: [south, west, north, east] in decimal degrees.
// These boxes are large enough to cover the full city area.

const BBOXES: Record<string, readonly [number, number, number, number]> = {
  skopje: [41.94, 21.30, 42.08, 21.60],  // covers all of Skopje municipality
  ohrid:  [40.90, 20.75, 41.12, 20.95],  // covers Ohrid and the lake shore
};

// ── OSM/Overpass type definitions ─────────────────────────────────────────────
//
// OpenStreetMap represents geographic features as "elements".
// Each element has a type (node/way/relation) and "tags" — key/value pairs
// that describe what the feature is. For example:
//   { historic: "bridge", name: "Stone Bridge", wikipedia: "en:Stone Bridge, Skopje" }

interface OsmTags {
  name?: string;          // default name (usually in local language — Macedonian)
  "name:en"?: string;     // English name (we prefer this for the UI)
  "name:mk"?: string;     // Macedonian name in Cyrillic script
  tourism?: string;       // e.g. "museum", "attraction", "viewpoint"
  historic?: string;      // e.g. "bridge", "castle", "mosque", "monument"
  natural?: string;       // e.g. "peak", "waterfall"
  amenity?: string;       // e.g. "place_of_worship", "marketplace"
  leisure?: string;       // e.g. "park", "garden", "nature_reserve"
  opening_hours?: string; // e.g. "Mo-Fr 09:00-18:00; Sa 10:00-16:00"
  wikipedia?: string;     // e.g. "en:Stone Bridge, Skopje" — used for Wikipedia enrichment
  wikidata?: string;      // e.g. "Q123456" — used for Wikidata image enrichment
  fee?: string;           // "yes", "no", or a price string
  website?: string;
  [key: string]: string | undefined; // allow any other tag
}

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;         // set for nodes (a single GPS point)
  lon?: number;         // set for nodes
  center?: { lat: number; lon: number }; // set for ways/relations (we use "out center" in the query)
  tags?: OsmTags;
}

// ── In-memory cache ───────────────────────────────────────────────────────────
//
// The full enrichment pipeline (Overpass + Wikipedia + Wikidata + Google Photos)
// can take 10-30 seconds on a cold start. Results are cached in server memory
// for 6 hours so subsequent requests are instant.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const cityCache = new Map<string, { ts: number; data: Landmark[] }>();

// ── Helper functions ──────────────────────────────────────────────────────────

// Returns true if a string contains at least one Cyrillic character.
// Used to detect whether a name tag is in Macedonian Cyrillic script.
function isCyrillic(s: string): boolean {
  return /[Ѐ-ӿ]/.test(s);
}

// Maps OSM tags to our app's Category type.
// OSM uses free-form tags, so we look for specific tag values and map them.
// The order of checks matters — we check the most specific first.
function osmCategory(tags: OsmTags): Category {
  const { tourism, historic, natural, leisure, shop, amenity } = tags;

  // Shopping: malls and markets first
  if (shop === "mall" || shop === "market" || amenity === "marketplace") return "shopping";

  // Outdoors: natural features and parks
  if (natural?.match(/peak|waterfall|canyon|lake|beach|wood|forest/)) return "outdoors";
  if (tourism === "viewpoint") return "outdoors";
  if (leisure?.match(/park|nature_reserve|garden/)) return "outdoors";

  // Culture: museums, galleries, religious sites, historic structures
  if (tourism === "museum" || tourism === "gallery") return "culture";
  if (historic?.match(/mosque|church|monastery|temple|chapel|cathedral|synagogue/)) return "culture";
  if (historic?.match(/castle|ruins|archaeological_site/)) return "culture";
  if (amenity === "place_of_worship") return "culture";

  // Everything else (tourist attractions, monuments, bridges, etc.) = landmark
  return "landmark";
}

// Parses an OSM opening_hours string into simple open/close times.
// OSM opening hours can be very complex: "Mo-Fr 09:00-18:00; Sa 10:00-16:00; PH off"
// We just grab the first HH:MM-HH:MM pattern we find and use those as defaults.
function parseHours(raw: string | undefined): { open: string; close: string } {
  if (!raw) return { open: "09:00", close: "18:00" }; // safe default if no hours in OSM
  const m = raw.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
  if (m) return { open: m[1], close: m[2] };
  return { open: "09:00", close: "18:00" };
}

// Converts the OSM "fee" tag to a price in MKD (Macedonian Denar).
// OSM only tells us yes/no, not the actual price, so we use a rough default.
function entryFeeFromTags(tags: OsmTags): number {
  if (tags.fee === "no" || tags.fee === "free") return 0;
  if (tags.fee === "yes") return 100; // rough default in MKD (~€1.60)
  return 0;
}

// Converts a raw OSM element into our app's Landmark shape.
// Returns null if the element doesn't have enough data to be shown in the UI
// (no name, no coordinates, or it's a road/waterway rather than a place).
function osmToLandmark(el: OsmElement, city: string): Landmark | null {
  const tags = el.tags ?? {};

  // Skip roads, streets, paths — the Overpass query tries to exclude these,
  // but some slip through if they also have tourism/historic tags.
  if (tags["highway"]) return null;

  // Skip waterways and land-use areas unless they have a tourism/historic tag
  // (e.g. a river is not a landmark, but a historic canal might be).
  if (tags["waterway"] && !tags["tourism"] && !tags["historic"]) return null;
  if (tags["landuse"] && !tags["tourism"] && !tags["historic"]) return null;

  // We need a name to display in the UI — skip unnamed features.
  // Prefer the English name, fall back to Macedonian/local name.
  const nameEn = tags["name:en"];
  const nameMk = tags["name:mk"] ?? tags["name"];
  const displayName = nameEn ?? nameMk;
  if (!displayName) return null;

  // Nodes have lat/lon directly. Ways and relations only have a "center" point
  // (we requested this with "out center" in the Overpass query).
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!lat || !lon) return null; // can't place on map without coordinates

  const hours = parseHours(tags["opening_hours"]);

  return {
    id: `osm_${el.type}_${el.id}`,   // prefix prevents ID collisions with Google Places landmarks
    name: displayName,
    // Only include Cyrillic name if we also have an English name (both must exist)
    ...(nameEn && nameMk && isCyrillic(nameMk) ? { nameCyrillic: nameMk } : {}),
    category: osmCategory(tags),
    coordinates: { lat, lng: lon },
    rating: 4.2,       // OSM has no ratings — neutral placeholder shown in UI
    reviewCount: 0,
    priceMKD: entryFeeFromTags(tags),
    openingHours: { ...hours, openNow: false }, // openNow: false because we don't know the current time zone
    walkTimeMinutes: 8, // placeholder — recalculated later using actual coordinates
    heroImage: "",      // filled in by Wikipedia/Wikidata/Google enrichment passes below
    eyebrow: city.charAt(0).toUpperCase() + city.slice(1), // "Skopje" or "Ohrid"
    history: "",        // filled in by Wikipedia enrichment pass
    practicalInfo: tags["opening_hours"] ?? "",
    // Preserve these IDs so the enrichment passes can look up the right articles/images
    ...(tags.wikidata   ? { wikidataId: tags.wikidata }         : {}),
    ...(tags.wikipedia  ? { wikipediaArticle: tags.wikipedia }  : {}),
  };
}

// ── Overpass query builder ────────────────────────────────────────────────────
//
// Overpass QL (Query Language) is a special query language for OpenStreetMap data.
// This function builds the query string that fetches all tourist-relevant features
// inside the given bounding box.
//
// The query uses [out:json] format (returns JSON, not XML).
// "timeout:30" — cancel if no response in 30 seconds.
// "out center tags" — for ways/relations, return the center point + all tags
//                     (instead of all the individual coordinate points of the polygon).

function buildQuery(bbox: readonly [number, number, number, number]): string {
  const b = bbox.join(","); // "41.94,21.30,42.08,21.60"
  return `[out:json][timeout:30];
(
  node["tourism"~"^(attraction|museum|gallery|viewpoint)$"][!"highway"](${b});
  node["historic"~"^(monument|castle|ruins|bridge|mosque|church|monastery|temple|archaeological_site|chapel|cathedral|fort|tower|wall|gate|palace|manor|memorial|wayside_cross|milestone)$"]["name"][!"highway"](${b});
  node["amenity"="place_of_worship"]["name"][!"highway"](${b});
  node["natural"~"^(peak|waterfall)$"]["name"](${b});
  node["leisure"~"^(park|nature_reserve|garden)$"]["name"][!"highway"](${b});
  node["shop"="mall"]["name"](${b});
  node["amenity"="marketplace"]["name"](${b});
  way["tourism"~"^(attraction|museum|gallery)$"][!"highway"](${b});
  way["historic"~"^(monument|bridge|castle|ruins|archaeological_site|mosque|church|monastery|fort|tower|wall|gate|palace)$"]["name"][!"highway"](${b});
  way["shop"="mall"]["name"](${b});
  way["amenity"="marketplace"]["name"](${b});
  way["leisure"~"^(park|nature_reserve|garden)$"]["name"][!"highway"](${b});
);
out center tags;`;
  // Explanation of query structure:
  //   node[...] — matches single GPS points with those tags
  //   way[...]  — matches polygons/lines (buildings, parks) with those tags
  //   [!"highway"] — exclude anything that also has a highway tag (roads)
  //   ["name"]     — require that the element has a name tag
  //   (${b})       — only within our bounding box
  //   The union () collects all matches across all lines.
}

// ── Overpass API fetch ────────────────────────────────────────────────────────
//
// Two public Overpass API endpoints are tried in order.
// The first is a French mirror; the second is the main German server.
// If the first fails (down or overloaded), we automatically try the second.

const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

// Sends the Overpass query and returns the raw OSM elements.
// The query is sent as a URL-encoded POST body (Overpass requires this format).
async function fetchOverpass(query: string): Promise<OsmElement[]> {
  const body = `data=${encodeURIComponent(query)}`;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "VisitMK/1.0 (university project)", // Overpass requires identifying the client
  };

  let lastError = "";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers, body });
      if (!res.ok) {
        lastError = `${endpoint}: ${res.status}`;
        continue; // try next endpoint
      }
      const json = await res.json();
      return json.elements as OsmElement[]; // the array of nodes/ways/relations
    } catch (err) {
      lastError = `${endpoint}: ${String(err)}`;
      // network error — try next endpoint
    }
  }
  // Both endpoints failed
  throw new Error(`All Overpass endpoints failed. Last: ${lastError}`);
}

// ── Deduplication ─────────────────────────────────────────────────────────────
//
// In OpenStreetMap, the same real-world place can be mapped twice:
//   - once as a node (a single GPS point, e.g. the entrance of a building)
//   - once as a way (the building outline polygon)
// Both have the same name and nearly the same coordinates.
// We remove duplicates where two landmarks have the same name and are within ~80 metres.

function dedup(landmarks: Landmark[]): Landmark[] {
  const kept: Landmark[] = [];
  for (const lm of landmarks) {
    const duplicate = kept.some(
      (k) =>
        k.name === lm.name &&
        // ~0.0008 degrees ≈ 80 metres — close enough to be the same physical place
        Math.abs(k.coordinates.lat - lm.coordinates.lat) < 0.0008 &&
        Math.abs(k.coordinates.lng - lm.coordinates.lng) < 0.0008,
    );
    if (!duplicate) kept.push(lm);
  }
  return kept;
}

// ── Public export ─────────────────────────────────────────────────────────────

// Main function: fetches and enriches all tourist landmarks for a given city.
// Called by getLandmarks() in osm.functions.ts.
//
// Full pipeline:
//   Overpass → osmToLandmark → dedup
//     → enrichWithWikipedia    (description + photo from Wikipedia article)
//     → enrichWithWikidata     (main image from Wikidata P18 property, batched)
//     → enrichWithGooglePhotos (Google photo + removes permanently-closed places)
//     → withSatelliteFallback  (Mapbox satellite image for anything still missing a photo)
//   → cache for 6h → return

export async function getLandmarksByCity(city: string): Promise<Landmark[]> {
  const key = city.toLowerCase();
  const bbox = BBOXES[key];
  if (!bbox) throw new Error(`Unknown city: ${city}. Supported: ${Object.keys(BBOXES).join(", ")}`);

  // Check cache first — return immediately if data is fresh enough
  const now = Date.now();
  const cached = cityCache.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;

  // ── Step 1: Fetch raw OSM data via Overpass ─────────────────────────────────
  const query = buildQuery(bbox);
  const elements = await fetchOverpass(query);
  // elements is a flat array of nodes and ways, each with tags

  // ── Step 2: Convert to Landmark shape + deduplicate ─────────────────────────
  const raw = dedup(
    elements
      .map((el) => osmToLandmark(el, key))
      .filter((l): l is Landmark => l !== null), // remove nulls (unnamed, no coords, etc.)
  );
  // At this point: raw Landmark objects with empty photos and descriptions

  // ── Step 3: Wikipedia enrichment ────────────────────────────────────────────
  // For landmarks that have a "wikipedia" tag in OSM (e.g. "en:Stone Bridge, Skopje"),
  // fetches the Wikipedia article summary and thumbnail photo.
  // API: https://en.wikipedia.org/api/rest_v1/page/summary/{title} (free, no key needed)
  const withWiki = await enrichWithWikipedia(raw);

  // ── Step 4: Wikidata enrichment ──────────────────────────────────────────────
  // For landmarks still missing a photo but with a "wikidata" tag (e.g. "Q123456"),
  // fetches the main image (Wikidata property P18) from Wikidata in batches of 50.
  // API: https://www.wikidata.org/w/api.php (free, no key needed)
  const withWikidata = await enrichWithWikidata(withWiki);

  // ── Step 5: Google Photos enrichment ────────────────────────────────────────
  // For landmarks still missing a photo, does a tight Google Places text search
  // by name + coordinates to find and attach a Google photo.
  // Also detects and removes permanently-closed places (e.g. a restaurant that has
  // since closed but is still in OSM).
  // API: Google Places API (New) — uses GOOGLE_PLACES_API_KEY from .env
  // Skipped entirely if the key is not configured.
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  const withGooglePhotos = apiKey ? await enrichWithGooglePhotos(withWikidata, apiKey) : withWikidata;

  // ── Step 6: Satellite image fallback ────────────────────────────────────────
  // Any landmark that still has no photo gets a Mapbox satellite/street image
  // generated from its GPS coordinates.
  // URL pattern: https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/{lng},{lat},16,0/800x450@2x
  const token = process.env.VITE_MAPBOX_TOKEN ?? "";
  const landmarks = withSatelliteFallback(withGooglePhotos, token);

  // ── Step 7: Cache and return ─────────────────────────────────────────────────
  cityCache.set(key, { ts: now, data: landmarks });
  return landmarks;
}
