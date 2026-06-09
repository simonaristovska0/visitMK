import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Handler bodies are server-only (tree-shaken from client).
// The .server.ts import below never reaches the browser.

/** GET tourist attractions near Skopje — cached 6h */
export const getTopAttractions = createServerFn({ method: "GET" }).handler(async () => {
  const { getTopAttractionsNearSkopje } = await import("./places.server");
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured in .env");
  }
  const attractions = await getTopAttractionsNearSkopje(apiKey);
  return { attractions };
});

/** GET /api top restaurants near Skopje — cached 1h */
export const getTopRestaurants = createServerFn({ method: "GET" }).handler(async () => {
  const { getTopRestaurantsNearSkopje } = await import("./places.server");
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured in .env");
  }
  const restaurants = await getTopRestaurantsNearSkopje(apiKey);
  return { restaurants };
});

/** POST free-text restaurant search — live, no cache */
export const searchRestaurants = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(20).optional().default(5),
    }),
  )
  .handler(async ({ data }) => {
    const { searchRestaurantsByText } = await import("./places.server");
    const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
    if (!apiKey || apiKey === "your_key_here") {
      throw new Error("GOOGLE_PLACES_API_KEY is not configured in .env");
    }
    const restaurants = await searchRestaurantsByText(data.query, data.maxResults, apiKey);
    return { restaurants };
  });
