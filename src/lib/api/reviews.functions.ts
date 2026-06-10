import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PlaceReview } from "../types";

interface GoogleReview {
  rating?: number;
  text?: { text: string };
  authorAttribution?: { displayName: string; photoUri?: string };
  relativePublishTimeDescription?: string;
  publishTime?: string;
}

/** Fetch the latest reviews for a Google place ID via the Places API (New). */
export const fetchPlaceReviews = createServerFn({ method: "GET" })
  .inputValidator(z.object({ placeId: z.string() }))
  .handler(async ({ data }): Promise<{ reviews: PlaceReview[] }> => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
    if (!apiKey) return { reviews: [] };

    // Our landmark IDs are prefixed with "places_"; strip it for the Google API.
    const googleId = data.placeId.replace(/^places_/, "");

    try {
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${googleId}?languageCode=en`,
        {
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "reviews",
          },
        },
      );
      if (!res.ok) return { reviews: [] };
      const body = (await res.json()) as { reviews?: GoogleReview[] };
      const reviews: PlaceReview[] = (body.reviews ?? [])
        .filter((r) => r.text?.text)
        .map((r) => ({
          author: r.authorAttribution?.displayName ?? "Google User",
          rating: r.rating ?? 0,
          text: r.text!.text,
          relativeTime: r.relativePublishTimeDescription ?? "",
        }));
      return { reviews };
    } catch {
      return { reviews: [] };
    }
  });
