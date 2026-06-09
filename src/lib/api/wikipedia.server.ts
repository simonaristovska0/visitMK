import type { Landmark } from "../types";

// ── Wikipedia REST API ─────────────────────────────────────────────────────
//
// Endpoint: https://en.wikipedia.org/api/rest_v1/page/summary/{title}
// No key required. Rate limit: ~200 req/s sustained — we stay well under.
// Per-article in-process cache (6h TTL) keeps repeat requests instant.

interface WikiSummary {
  extract?: string;
  description?: string;
  thumbnail?: { source: string };
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const articleCache = new Map<string, { ts: number; data: WikiSummary | null }>();
const wikidataCache = new Map<string, { ts: number; imageUrl: string }>();
const WIKIDATA_BATCH = 50;

// ── Helpers ────────────────────────────────────────────────────────────────

// OSM wikipedia tag format: "en:Stone Bridge, Skopje" or "mk:Камен мост"
// Returns the English title if present, otherwise the first available.
function parseWikiTitle(tag: string): string | null {
  const parts = tag.split(":");
  if (parts.length === 1) return parts[0].trim() || null;      // bare title
  if (parts[0].toLowerCase() === "en") return parts.slice(1).join(":").trim() || null;
  // Non-English article — skip (we only fetch English summaries)
  return null;
}

async function fetchSummary(title: string): Promise<WikiSummary | null> {
  const cached = articleCache.get(title);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "VisitMK/1.0 (university project; contact: simonaristovska@example.com)" },
    });
    if (!res.ok) {
      articleCache.set(title, { ts: Date.now(), data: null });
      return null;
    }
    const data = (await res.json()) as WikiSummary;
    articleCache.set(title, { ts: Date.now(), data });
    return data;
  } catch {
    articleCache.set(title, { ts: Date.now(), data: null });
    return null;
  }
}

// Fetches Wikidata P18 (image) in batches of 50. Returns QID → Commons URL.
async function fetchWikidataImageBatch(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const now = Date.now();
  const uncached: string[] = [];

  for (const id of ids) {
    const hit = wikidataCache.get(id);
    if (hit && now - hit.ts < CACHE_TTL_MS) {
      if (hit.imageUrl) result.set(id, hit.imageUrl);
    } else {
      uncached.push(id);
    }
  }

  if (uncached.length === 0) return result;

  const batches: string[][] = [];
  for (let i = 0; i < uncached.length; i += WIKIDATA_BATCH) {
    batches.push(uncached.slice(i, i + WIKIDATA_BATCH));
  }

  await Promise.allSettled(
    batches.map(async (batch) => {
      try {
        const url =
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=claims&format=json&languages=en`;
        const res = await fetch(url, {
          headers: { "User-Agent": "VisitMK/1.0 (university project)" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const ts = Date.now();
        for (const id of batch) {
          const p18 = data.entities?.[id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
          const imageUrl =
            typeof p18 === "string"
              ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p18.replace(/ /g, "_"))}?width=800`
              : "";
          wikidataCache.set(id, { ts, imageUrl });
          if (imageUrl) result.set(id, imageUrl);
        }
      } catch { /* silent */ }
    }),
  );

  return result;
}

// ── Public exports ─────────────────────────────────────────────────────────

/**
 * Enriches landmarks that have a `wikipediaArticle` tag with:
 *   - `history`   → Wikipedia extract (full introductory paragraph)
 *   - `heroImage` → Wikipedia thumbnail (only if currently empty)
 *
 * Fetches are done in parallel; failures are silently skipped so the
 * landmark still appears without a description.
 */
export async function enrichWithWikipedia(landmarks: Landmark[]): Promise<Landmark[]> {
  const enrichable = landmarks.filter(
    (l) => l.wikipediaArticle && !l.history,
  );
  if (enrichable.length === 0) return landmarks;

  const results = await Promise.allSettled(
    enrichable.map(async (lm) => {
      const title = parseWikiTitle(lm.wikipediaArticle!);
      if (!title) return { id: lm.id, data: null };
      const data = await fetchSummary(title);
      return { id: lm.id, data };
    }),
  );

  const enrichMap = new Map<string, WikiSummary>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.data) {
      enrichMap.set(result.value.id, result.value.data);
    }
  }

  if (enrichMap.size === 0) return landmarks;

  return landmarks.map((lm) => {
    const wiki = enrichMap.get(lm.id);
    if (!wiki) return lm;
    return {
      ...lm,
      history: wiki.extract ?? lm.history,
      heroImage: !lm.heroImage && wiki.thumbnail?.source ? wiki.thumbnail.source : lm.heroImage,
    };
  });
}

/**
 * For every landmark that still has no heroImage but has a `wikidataId`,
 * fetches the Wikidata P18 (image) property and fills in the Commons URL.
 * Uses batched requests (up to 50 IDs per call) with 6h in-memory cache.
 */
export async function enrichWithWikidata(landmarks: Landmark[]): Promise<Landmark[]> {
  const needsImage = landmarks.filter((l) => !l.heroImage && l.wikidataId);
  if (needsImage.length === 0) return landmarks;

  const imageMap = await fetchWikidataImageBatch(needsImage.map((l) => l.wikidataId!));
  if (imageMap.size === 0) return landmarks;

  return landmarks.map((lm) => {
    if (lm.heroImage || !lm.wikidataId) return lm;
    const imageUrl = imageMap.get(lm.wikidataId);
    return imageUrl ? { ...lm, heroImage: imageUrl } : lm;
  });
}

/**
 * Last-resort fallback: replaces empty heroImage with a Mapbox satellite
 * static image of the landmark's exact coordinates.
 * The token is the already-public VITE_MAPBOX_TOKEN (safe to embed in URLs).
 */
export function withSatelliteFallback(landmarks: Landmark[], token: string): Landmark[] {
  if (!token) return landmarks;
  return landmarks.map((lm) => {
    if (lm.heroImage) return lm;
    const { lat, lng } = lm.coordinates;
    return {
      ...lm,
      heroImage: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${lng.toFixed(5)},${lat.toFixed(5)},16,0/800x450@2x?access_token=${token}`,
    };
  });
}
