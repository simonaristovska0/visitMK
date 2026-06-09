export interface ChatMsg {
  role: "user" | "ai";
  content: string;
}

export interface LandmarkContext {
  name: string;
  category: string;
  eyebrow?: string;
  history?: string;
  weeklyHours?: string[];
}

const SYSTEM_PROMPT = `You are VisitMK — an expert local guide for North Macedonia. Help visitors explore Skopje and the wider region: landmarks, restaurants, culture, history, hidden gems, and practical travel tips.

Be warm, concise, and conversational. For place descriptions, be vivid and specific.
For itinerary questions, suggest 3–5 places with brief reasoning.
Keep answers under 150 words. Always write complete sentences — never cut off mid-sentence.
Write in plain text only — no markdown, no asterisks, no bullet dashes.`;

export async function generateAIResponse(
  messages: ChatMsg[],
  landmark: LandmarkContext | undefined,
  apiKey: string,
): Promise<string> {
  let systemText = SYSTEM_PROMPT;

  if (landmark) {
    const parts: string[] = [
      `Context: the user is viewing "${landmark.name}" — a ${landmark.category} in Skopje, North Macedonia.`,
    ];
    if (landmark.eyebrow) parts.push(`Address: ${landmark.eyebrow}.`);
    if (landmark.history) parts.push(`About: ${landmark.history.slice(0, 600)}`);
    if (landmark.weeklyHours?.length) {
      parts.push(`Hours: ${landmark.weeklyHours.slice(0, 4).join(" | ")}.`);
    }
    systemText += "\n\n" + parts.join(" ");
  }

  const chatMessages = messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const body = JSON.stringify({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "system", content: systemText }, ...chatMessages],
    max_tokens: 1024,
    temperature: 0.75,
  });

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Groq returned an empty response");
  return text.trim();
}
