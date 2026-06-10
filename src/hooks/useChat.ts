import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, Coordinates, Itinerary, Landmark } from "@/lib/types";
import { sendUnifiedChatMessage } from "@/lib/api/ai.functions";

interface ConvMsg { role: "user" | "assistant"; content: string }

interface UseChatCallbacks {
  onGroupAdded: (id: string, label: string, landmarks: Landmark[]) => void;
  onRouteCreated: (itinerary: Itinerary, landmarks: Landmark[]) => void;
}

const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ── sessionStorage helpers ────────────────────────────────────────────────────

const SK = {
  messages:   "vmk_chat_messages",
  history:    "vmk_chat_history",
  landmarks:  "vmk_known_landmarks",
  itinerary:  "vmk_current_itinerary",
};

function loadSession<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}

function saveSession(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChat({ onGroupAdded, onRouteCreated }: UseChatCallbacks) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadSession<ChatMessage[]>(SK.messages, []),
  );
  const [isLoading, setIsLoading] = useState(false);
  const historyRef         = useRef<ConvMsg[]>(loadSession<ConvMsg[]>(SK.history, []));
  const knownLandmarksRef  = useRef<Landmark[]>(loadSession<Landmark[]>(SK.landmarks, []));
  const currentItineraryRef = useRef<Itinerary | null>(loadSession<Itinerary | null>(SK.itinerary, null));

  // Persist messages on every change
  useEffect(() => {
    saveSession(SK.messages, messages);
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string, userLocation: Coordinates | null) => {
      setMessages((prev) => [
        ...prev,
        { id: genId(), role: "user", type: "text", content: text, createdAt: Date.now() },
      ]);

      historyRef.current = [...historyRef.current, { role: "user", content: text }];
      saveSession(SK.history, historyRef.current);

      setIsLoading(true);
      try {
        const result = await sendUnifiedChatMessage({
          data: {
            conversationHistory: historyRef.current,
            userLocation,
            persistedLandmarks: knownLandmarksRef.current as unknown as { id: string; name: string }[],
            persistedItinerary: currentItineraryRef.current as unknown as Parameters<typeof sendUnifiedChatMessage>[0]["data"]["persistedItinerary"],
          },
        });

        if (result.content.trim()) {
          historyRef.current = [...historyRef.current, { role: "assistant", content: result.content }];
          saveSession(SK.history, historyRef.current);
        }

        if (result.itinerary) {
          // Route takes priority — always show tour widget, discard any stray pin groups
          currentItineraryRef.current = result.itinerary.route;
          saveSession(SK.itinerary, currentItineraryRef.current);

          onRouteCreated(result.itinerary.route, result.itinerary.landmarks);

          const knownIds = new Set(knownLandmarksRef.current.map((l) => l.id));
          knownLandmarksRef.current = [
            ...knownLandmarksRef.current,
            ...result.itinerary.landmarks.filter((l) => !knownIds.has(l.id)),
          ];
          saveSession(SK.landmarks, knownLandmarksRef.current);

          setMessages((prev) => [
            ...prev,
            {
              id: genId(),
              role: "assistant",
              type: "route_created",
              content: result.content || "Your tour route is ready!",
              itinerary: result.itinerary!.route,
              landmarks: result.itinerary!.landmarks,
              createdAt: Date.now(),
            },
          ]);
        } else if (result.placesGroups.length > 0) {
          for (const group of result.placesGroups) {
            onGroupAdded(group.id, group.label, group.landmarks);
            const newIds = new Set(knownLandmarksRef.current.map((l) => l.id));
            knownLandmarksRef.current = [
              ...knownLandmarksRef.current,
              ...group.landmarks.filter((l) => !newIds.has(l.id)),
            ];
          }
          saveSession(SK.landmarks, knownLandmarksRef.current);

          const firstGroup = result.placesGroups[0];
          setMessages((prev) => [
            ...prev,
            {
              id: genId(),
              role: "assistant",
              type: "places_added",
              content: result.content || `Found ${firstGroup.landmarks.length} ${firstGroup.label.toLowerCase()}.`,
              groupId: firstGroup.id,
              landmarks: firstGroup.landmarks,
              createdAt: Date.now(),
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: genId(), role: "assistant", type: "text", content: result.content, createdAt: Date.now() },
          ]);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: "assistant", type: "error", content: msg, createdAt: Date.now() },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [onGroupAdded, onRouteCreated],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    knownLandmarksRef.current = [];
    currentItineraryRef.current = null;
    saveSession(SK.messages, []);
    saveSession(SK.history, []);
    saveSession(SK.landmarks, []);
    saveSession(SK.itinerary, null);
  }, []);

  return { messages, isLoading, sendMessage, clearMessages };
}
