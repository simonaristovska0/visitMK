import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MsgSchema = z.object({
  role: z.enum(["user", "ai"]),
  content: z.string().min(1),
});

const LandmarkCtxSchema = z.object({
  name: z.string(),
  category: z.string(),
  eyebrow: z.string().optional(),
  history: z.string().optional(),
  weeklyHours: z.array(z.string()).optional(),
});

export const sendAIMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      messages: z.array(MsgSchema).min(1).max(20),
      landmark: LandmarkCtxSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { generateAIResponse } = await import("./ai.server");
    const apiKey = process.env.DEEPSEEK_API_KEY ?? "";
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured in .env");
    const response = await generateAIResponse(data.messages, data.landmark, apiKey);
    return { response };
  });

const CoordinatesSchema = z.object({ lat: z.number(), lng: z.number() });

const ConvMsgSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const PersistedLandmarkSchema = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough();

const PersistedItinerarySchema = z.object({
  id: z.string(),
  wish: z.string(),
  travelMode: z.enum(["walking", "driving"]),
  totalDurationMinutes: z.number(),
  totalDistanceKm: z.number(),
  stops: z.array(
    z.object({
      landmarkId: z.string(),
      order: z.number(),
      durationMinutes: z.number(),
    }).passthrough(),
  ),
}).passthrough();

export const sendUnifiedChatMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      conversationHistory: z.array(ConvMsgSchema).max(40),
      userLocation: CoordinatesSchema.nullable().optional(),
      persistedLandmarks: z.array(PersistedLandmarkSchema).optional(),
      persistedItinerary: PersistedItinerarySchema.nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { executeUnifiedChat } = await import("./ai.server");
    const deepseekKey = process.env.DEEPSEEK_API_KEY ?? "";
    if (!deepseekKey) throw new Error("DEEPSEEK_API_KEY is not configured in .env");
    const mapboxToken = process.env.VITE_MAPBOX_TOKEN ?? "";
    return executeUnifiedChat(
      data.conversationHistory,
      data.userLocation ?? null,
      deepseekKey,
      mapboxToken,
      (data.persistedLandmarks ?? []) as unknown as import("../types").Landmark[],
      (data.persistedItinerary ?? null) as unknown as import("../types").Itinerary | null,
    );
  });
