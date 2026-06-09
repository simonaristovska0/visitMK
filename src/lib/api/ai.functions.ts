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
    const apiKey = process.env.GROQ_API_KEY ?? "";
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured in .env");
    const response = await generateAIResponse(data.messages, data.landmark, apiKey);
    return { response };
  });
