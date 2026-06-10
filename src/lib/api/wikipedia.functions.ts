import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface WikipediaResult {
  title: string;
  extract: string;
  thumbnail?: string;
  url: string;
}

const UA = "VisitMK/1.0 (university project; contact: visitMK@example.com)";

// OSM wikipedia tag: "en:Stone Bridge, Skopje" → "Stone Bridge, Skopje"
function parseOsmTitle(tag: string): string | null {
  const [lang, ...rest] = tag.split(":");
  if (lang.toLowerCase() === "en" && rest.length) return rest.join(":").trim() || null;
  if (rest.length === 0) return lang.trim() || null; // bare title, no lang prefix
  return null; // non-English tag — skip
}

/**
 * Fetches the best Wikipedia article for a landmark using a three-step strategy:
 *
 * 1. Wikidata sitelink  — if wikidataId is known, get the exact English article
 * 2. OSM Wikipedia tag  — if present, use the stored article title
 * 3. GPS GeoSearch      — finds Wikipedia articles within 150 m of the coordinates
 *                         (coordinate-based = immune to name-matching errors)
 *
 * Returns null when no article can be found.
 */
export const fetchLandmarkWikipedia = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      lat: z.number(),
      lng: z.number(),
      wikidataId: z.string().optional(),
      wikipediaArticle: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<WikipediaResult | null> => {
    let articleTitle: string | null = null;

    // ── Step 1: Wikidata sitelink ───────────────────────────────────────────
    if (data.wikidataId && !articleTitle) {
      try {
        const res = await fetch(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${data.wikidataId}&props=sitelinks&sitefilter=enwiki&format=json`,
          { headers: { "User-Agent": UA } },
        );
        if (res.ok) {
          const json = (await res.json()) as {
            entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }>;
          };
          const title = json.entities?.[data.wikidataId]?.sitelinks?.enwiki?.title;
          if (title) articleTitle = title;
        }
      } catch { /* continue */ }
    }

    // ── Step 2: OSM Wikipedia article tag ──────────────────────────────────
    if (!articleTitle && data.wikipediaArticle) {
      articleTitle = parseOsmTitle(data.wikipediaArticle);
    }

    // ── Step 3: GPS GeoSearch (works for all Google Places landmarks) ───────
    if (!articleTitle) {
      try {
        const url =
          `https://en.wikipedia.org/w/api.php` +
          `?action=query&list=geosearch` +
          `&gscoord=${data.lat}|${data.lng}` +
          `&gsradius=150&gslimit=3&format=json`;
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (res.ok) {
          const json = (await res.json()) as {
            query?: { geosearch?: Array<{ title: string }> };
          };
          const first = json.query?.geosearch?.[0];
          if (first?.title) articleTitle = first.title;
        }
      } catch { /* continue */ }
    }

    if (!articleTitle) return null;

    // ── Fetch full summary ──────────────────────────────────────────────────
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`,
        { headers: { "User-Agent": UA } },
      );
      if (!res.ok) return null;
      const wiki = (await res.json()) as {
        title?: string;
        extract?: string;
        thumbnail?: { source: string };
        content_urls?: { desktop?: { page?: string } };
      };
      if (!wiki.extract) return null;
      return {
        title: wiki.title ?? articleTitle,
        extract: wiki.extract,
        thumbnail: wiki.thumbnail?.source,
        url:
          wiki.content_urls?.desktop?.page ??
          `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle)}`,
      };
    } catch {
      return null;
    }
  });
