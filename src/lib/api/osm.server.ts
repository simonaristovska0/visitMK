import type { Category, Landmark } from "../types";
import { enrichWithWikipedia, enrichWithWikidata, withSatelliteFallback } from "./wikipedia.server";
import { enrichWithGooglePhotos } from "./places.server";

// ── OSM/Overpass bounding boxes ────────────────────────────────────────────

const BBOXES: Record<string, readonly [number, number, number, number]> = {
  skopje: [41.94, 21.30, 42.08, 21.60],  // [south, west, north, east]
  ohrid:  [40.90, 20.75, 41.12, 20.95],
};

// ── Overpass types ─────────────────────────────────────────────────────────

interface OsmTags {
  name?: string;
  "name:en"?: string;
  "name:mk"?: string;
  tourism?: string;
  historic?: string;
  natural?: string;
  amenity?: string;
  leisure?: string;
  opening_hours?: string;
  wikipedia?: string;
  wikidata?: string;
  fee?: string;
  website?: string;
  [key: string]: string | undefined;
}

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
}

// ── In-memory cache (per city, 6h TTL) ────────────────────────────────────

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cityCache = new Map<string, { ts: number; data: Landmark[] }>();

// ── Helpers ────────────────────────────────────────────────────────────────

function isCyrillic(s: string): boolean {
  return /[Ѐ-ӿ]/.test(s);
}

function osmCategory(tags: OsmTags): Category {
  const { tourism, historic, natural, leisure, shop, amenity } = tags;

  if (shop === "mall" || shop === "market" || amenity === "marketplace") return "shopping";

  if (natural?.match(/peak|waterfall|canyon|lake|beach|wood|forest/)) return "outdoors";
  if (tourism === "viewpoint") return "outdoors";
  if (leisure?.match(/park|nature_reserve|garden/)) return "outdoors";

  if (tourism === "museum" || tourism === "gallery") return "culture";
  if (historic?.match(/mosque|church|monastery|temple|chapel|cathedral|synagogue/)) return "culture";
  if (historic?.match(/castle|ruins|archaeological_site/)) return "culture";
  if (amenity === "place_of_worship") return "culture";

  return "landmark";
}

function parseHours(raw: string | undefined): { open: string; close: string } {
  if (!raw) return { open: "09:00", close: "18:00" };
  // Grab first time range that looks like HH:MM-HH:MM
  const m = raw.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
  if (m) return { open: m[1], close: m[2] };
  return { open: "09:00", close: "18:00" };
}

function entryFeeFromTags(tags: OsmTags): number {
  if (tags.fee === "no" || tags.fee === "free") return 0;
  if (tags.fee === "yes") return 100; // rough default in MKD
  return 0;
}

function osmToLandmark(el: OsmElement, city: string): Landmark | null {
  const tags = el.tags ?? {};

  // Exclude roads, streets, paths — anything with a highway tag
  if (tags["highway"]) return null;
  // Exclude pure waterway/landuse elements that aren't tourist destinations
  if (tags["waterway"] && !tags["tourism"] && !tags["historic"]) return null;
  if (tags["landuse"] && !tags["tourism"] && !tags["historic"]) return null;

  // Require a name
  const nameEn = tags["name:en"];
  const nameMk = tags["name:mk"] ?? tags["name"];
  const displayName = nameEn ?? nameMk;
  if (!displayName) return null;

  // Coordinates — nodes have lat/lon directly, ways have center
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!lat || !lon) return null;

  const hours = parseHours(tags["opening_hours"]);

  return {
    id: `osm_${el.type}_${el.id}`,
    name: displayName,
    ...(nameEn && nameMk && isCyrillic(nameMk) ? { nameCyrillic: nameMk } : {}),
    category: osmCategory(tags),
    coordinates: { lat, lng: lon },
    rating: 4.2,          // no crowd-sourced rating from OSM; neutral default
    reviewCount: 0,
    priceMKD: entryFeeFromTags(tags),
    openingHours: { ...hours, openNow: false },
    walkTimeMinutes: 8,
    heroImage: "",         // Wikipedia photo proxy added in later phase
    eyebrow: city.charAt(0).toUpperCase() + city.slice(1),
    history: "",           // Wikipedia description added in later phase
    practicalInfo: tags["opening_hours"] ?? "",
    // Preserve wikidata/wikipedia IDs for later enrichment
    ...(tags.wikidata ? { wikidataId: tags.wikidata } : {}),
    ...(tags.wikipedia ? { wikipediaArticle: tags.wikipedia } : {}),
  };
}

// ── Overpass query ─────────────────────────────────────────────────────────

function buildQuery(bbox: readonly [number, number, number, number]): string {
  const b = bbox.join(",");
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
}

const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

async function fetchOverpass(query: string): Promise<OsmElement[]> {
  const body = `data=${encodeURIComponent(query)}`;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "VisitMK/1.0 (university project)",
  };

  let lastError = "";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers, body });
      if (!res.ok) {
        lastError = `${endpoint}: ${res.status}`;
        continue;
      }
      const json = await res.json();
      return json.elements as OsmElement[];
    } catch (err) {
      lastError = `${endpoint}: ${String(err)}`;
    }
  }
  throw new Error(`All Overpass endpoints failed. Last: ${lastError}`);
}

// ── Deduplication ──────────────────────────────────────────────────────────

function dedup(landmarks: Landmark[]): Landmark[] {
  // Remove duplicates where both a node and way describe the same place
  // (same name + coordinates within ~80 m)
  const kept: Landmark[] = [];
  for (const lm of landmarks) {
    const duplicate = kept.some(
      (k) =>
        k.name === lm.name &&
        Math.abs(k.coordinates.lat - lm.coordinates.lat) < 0.0008 &&
        Math.abs(k.coordinates.lng - lm.coordinates.lng) < 0.0008,
    );
    if (!duplicate) kept.push(lm);
  }
  return kept;
}

// ── Public export ──────────────────────────────────────────────────────────

/**
 * Returns tourist landmarks for the given city from OpenStreetMap.
 * Results are cached in-process for 6 hours.
 *
 * @param city "skopje" | "ohrid"
 */
export async function getLandmarksByCity(city: string): Promise<Landmark[]> {
  const key = city.toLowerCase();
  const bbox = BBOXES[key];
  if (!bbox) throw new Error(`Unknown city: ${city}. Supported: ${Object.keys(BBOXES).join(", ")}`);

  const now = Date.now();
  const cached = cityCache.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;

  const query = buildQuery(bbox);
  const elements = await fetchOverpass(query);

  const raw = dedup(
    elements
      .map((el) => osmToLandmark(el, key))
      .filter((l): l is Landmark => l !== null),
  );

  const withWiki = await enrichWithWikipedia(raw);
  const withWikidata = await enrichWithWikidata(withWiki);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  const withGooglePhotos = apiKey ? await enrichWithGooglePhotos(withWikidata, apiKey) : withWikidata;
  const token = process.env.VITE_MAPBOX_TOKEN ?? "";
  const landmarks = withSatelliteFallback(withGooglePhotos, token);
  cityCache.set(key, { ts: now, data: landmarks });
  return landmarks;
}
