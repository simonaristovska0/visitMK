import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** GET landmarks for a given city from OSM/Overpass. Cached 6h. */
export const getLandmarks = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      city: z.enum(["skopje", "ohrid"]),
    }),
  )
  .handler(async ({ data }) => {
    const { getLandmarksByCity } = await import("./osm.server");
    const landmarks = await getLandmarksByCity(data.city);
    return { landmarks };
  });
