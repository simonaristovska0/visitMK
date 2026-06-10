import { useRef, useEffect, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Bot, AlertCircle, Loader2, SquarePen } from "lucide-react";
import type { ChatMessage, Itinerary, Landmark } from "@/lib/types";
import { PlacesResultCard } from "@/components/PlacesResultCard";
import { TourSummaryCard } from "@/components/TourSummaryCard";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  groupColors: Record<string, string>;   // groupId → hex color
  onSend: (text: string) => void;
  onLandmarkClick?: (id: string) => void;
  onRestoreTour?: (itinerary: Itinerary, landmarks: Landmark[]) => void;
  onNewChat?: () => void;
  className?: string;
}

const SUGGESTIONS = [
  "Top restaurants near me",
  "Best landmarks in Skopje",
  "Plan me a morning tour",
  "Museums near the old bazaar",
];

export function ChatPanel({
  messages,
  isLoading,
  groupColors,
  onSend,
  onLandmarkClick,
  onRestoreTour,
  onNewChat,
  className,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const val = inputRef.current?.value.trim();
    if (!val || isLoading) return;
    if (inputRef.current) inputRef.current.value = "";
    onSend(val);
  }

  return (
    <div className={cn("flex h-full flex-col bg-background", className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">VisitMK Guide</span>
        </div>
        {onNewChat && messages.length > 0 && (
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="New chat"
          >
            <SquarePen className="h-3.5 w-3.5" />
            New chat
          </button>
        )}
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        {/* Empty state — suggestion chips */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-4 pt-8">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="font-serif text-lg font-semibold">VisitMK Guide</p>
              <p className="mt-1 text-sm text-muted-foreground">Ask me anything about Skopje</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSend(s)}
                  className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:border-primary/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <MessageRow
            key={msg.id}
            message={msg}
            groupColor={msg.type === "places_added" ? (groupColors[msg.groupId] ?? "#E85D04") : "#E85D04"}
            onLandmarkClick={onLandmarkClick}
            onRestoreTour={onRestoreTour}
          />
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex items-end gap-2">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-border bg-card p-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask about Skopje..."
            disabled={isLoading}
            className={cn(
              "flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30",
              "disabled:opacity-50",
            )}
          />
          <button
            type="submit"
            disabled={isLoading}
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground",
              "transition-opacity disabled:opacity-50 hover:opacity-90",
            )}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Individual message row ────────────────────────────────────────────────────

interface MessageRowProps {
  message: ChatMessage;
  groupColor: string;
  onLandmarkClick?: (id: string) => void;
  onRestoreTour?: (itinerary: Itinerary, landmarks: Landmark[]) => void;
}

function MessageRow({ message, groupColor, onLandmarkClick, onRestoreTour }: MessageRowProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5">
          <p className="text-sm text-primary-foreground">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="max-w-[88%] flex-1">
        {message.type === "error" ? (
          <div className="flex items-start gap-2 rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/10 px-4 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{message.content}</p>
          </div>
        ) : message.type === "places_added" ? (
          <PlacesResultCard
            content={message.content}
            landmarks={message.landmarks}
            groupColor={groupColor}
            onLandmarkClick={onLandmarkClick}
          />
        ) : message.type === "route_created" ? (
          <TourSummaryCard
            content={message.content}
            itinerary={message.itinerary}
            landmarks={message.landmarks}
            onStopClick={onLandmarkClick}
            onRestore={onRestoreTour ? () => onRestoreTour(message.itinerary, message.landmarks) : undefined}
          />
        ) : (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5">
            <div className="prose prose-sm dark:prose-invert max-w-none text-foreground
                [&_p]:leading-relaxed [&_p]:mb-1.5 [&_p:last-child]:mb-0
                [&_ul]:my-1.5 [&_ul]:pl-4 [&_li]:mb-0.5
                [&_ol]:my-1.5 [&_ol]:pl-4
                [&_strong]:font-semibold [&_strong]:text-foreground
                [&_em]:text-foreground/80
                [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
