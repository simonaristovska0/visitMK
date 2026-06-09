import { useState, useRef, useEffect } from "react";
import { Send, Maximize2, X, Bot } from "lucide-react";
import type { Landmark } from "@/lib/types";
import { sendAIMessage } from "@/lib/api/ai.functions";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
}

const SUGGESTIONS: Record<string, string[]> = {
  landmark: ["Best time of day to visit?", "Is it good for kids?", "Tell me the history", "What's nearby?"],
  culture: ["What can I see inside?", "How long should I visit?", "Historical significance?", "Entry tips?"],
  food: ["What's the specialty here?", "Should I book ahead?", "Best dishes to try?", "Local favourite dishes?"],
  cafe: ["Best drinks to try?", "Good for remote work?", "Popular with locals?", "What's the vibe?"],
  outdoors: ["What should I bring?", "Best walking routes?", "Best time of year?", "Is it accessible?"],
  shopping: ["What to buy here?", "How to bargain?", "Best time to visit?"],
};

function getSuggestions(category: string): string[] {
  return SUGGESTIONS[category] ?? ["What should I see first?", "Any local tips?", "How do I get there?"];
}

interface Props {
  landmark: Landmark;
}

export function AskAIChat({ landmark }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset when landmark changes
  useEffect(() => {
    setMessages([]);
    setInput("");
    setError(null);
    setExpanded(false);
  }, [landmark.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setError(null);
    const userMsg: ChatMessage = { id: `${Date.now()}-u`, role: "user", content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);

    try {
      const { response } = await sendAIMessage({
        data: {
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          landmark: {
            name: landmark.name,
            category: landmark.category,
            eyebrow: landmark.eyebrow,
            history: landmark.history,
            weeklyHours: landmark.weeklyHours,
          },
        },
      });
      setMessages((prev) => [...prev, { id: `${Date.now()}-ai`, role: "ai", content: response }]);
    } catch {
      setError("Couldn't reach the AI — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const suggestions = getSuggestions(landmark.category);

  // ── Shared UI blocks ───────────────────────────────────────────────────────

  const messageList = (
    <div className="flex-1 overflow-y-auto space-y-4 pr-0.5">
      {messages.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Ask anything about{" "}
            <span className="font-serif italic text-foreground">{landmark.name}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-full border border-border px-3 py-1.5 text-xs transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((m) => (
        <div
          key={m.id}
          className={cn("flex gap-2.5", m.role === "user" ? "justify-end" : "justify-start")}
        >
          {m.role === "ai" && (
            <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-3.5 w-3.5" />
            </div>
          )}
          <div
            className={cn(
              "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
              m.role === "user"
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm bg-muted text-foreground",
            )}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
          </div>
        </div>
      ))}

      {loading && (
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3.5">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-center text-xs text-destructive">{error}</p>}

      <div ref={bottomRef} />
    </div>
  );

  const inputBar = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(input);
      }}
      className="flex items-end gap-2"
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={`Ask about ${landmark.name}…`}
        rows={1}
        className="max-h-[120px] flex-1 resize-none rounded-2xl border border-border bg-background/80 px-4 py-2.5 text-sm outline-none transition focus:border-primary placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={!input.trim() || loading}
        aria-label="Send"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );

  // ── Expanded (full-screen overlay) ─────────────────────────────────────────

  if (expanded) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-card">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Close full screen"
            className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Ask AI
            </p>
            <p className="truncate font-serif text-base leading-tight">{landmark.name}</p>
          </div>
        </div>

        {/* Chat area */}
        <div
          className="flex flex-1 flex-col overflow-hidden px-5 py-4"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          {messageList}
          {inputBar}
        </div>
      </div>
    );
  }

  // ── Compact (inside LandmarkDetail tab) ────────────────────────────────────

  return (
    <div className="flex h-full flex-col px-5 py-4 md:px-7">
      {/* Subheader row */}
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <p className="text-sm text-muted-foreground">Chat with AI about this place</p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Open full-screen chat"
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable message area — fills all available space */}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-0.5">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-full border border-border px-3 py-1.5 text-xs transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex gap-2.5", m.role === "user" ? "justify-end" : "justify-start")}
          >
            {m.role === "ai" && (
              <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-3.5 w-3.5" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                m.role === "user"
                  ? "rounded-tr-sm bg-primary text-primary-foreground"
                  : "rounded-tl-sm bg-muted text-foreground",
              )}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2.5">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3.5">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-center text-xs text-destructive">{error}</p>}

        <div ref={bottomRef} />
      </div>

      {/* Input pinned at bottom */}
      <div className="shrink-0 pt-3">
        {inputBar}
      </div>
    </div>
  );
}
