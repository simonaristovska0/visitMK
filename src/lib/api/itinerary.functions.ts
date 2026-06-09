import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CoordinatesSchema = z.object({ lat: z.number(), lng: z.number() });

const WaypointSchema = z.object({
  id: z.string(),
  coordinates: CoordinatesSchema,
  category: z.enum(["outdoors", "food", "cafe", "shopping", "culture", "landmark"]),
});

/** Build an optimised itinerary via Mapbox Matrix + Directions APIs. */
export const buildItinerary = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      waypoints: z.array(WaypointSchema).min(1).max(25),
      travelMode: z.enum(["walking", "driving"]),
      wish: z.string().default("A day exploring the highlights"),
    }),
  )
  .handler(async ({ data }) => {
    const { buildItinerary: build } = await import("./itinerary.server");
    const token = process.env.VITE_MAPBOX_TOKEN ?? "";
    if (!token) throw new Error("VITE_MAPBOX_TOKEN is not configured");
    const itinerary = await build(data.waypoints, data.travelMode, data.wish, token);
    return { itinerary };
  });
