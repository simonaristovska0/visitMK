import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const LandmarkSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export const planTour = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      wish: z.string().min(1).max(500),
      landmarks: z.array(LandmarkSummarySchema).min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.GROQ_API_KEY ?? "";
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured");
    const { planTourWithAI } = await import("./tour.server");
    try {
      const ids = await planTourWithAI(data.wish, data.landmarks, apiKey);
      return { ids };
    } catch (err) {
      console.error("[planTour] Gemini error:", err);
      throw err;
    }
  });
