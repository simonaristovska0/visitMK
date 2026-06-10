import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Clock, Route, Footprints, Car, PenLine } from "lucide-react";
import type { Itinerary, Landmark } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TourSummaryCardProps {
  content: string;
  itinerary: Itinerary;
  landmarks: Landmark[];
  onStopClick?: (id: string) => void;
  onRestore?: () => void;
}

function formatMins(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function TourSummaryCard({ content, itinerary, landmarks, onStopClick, onRestore }: TourSummaryCardProps) {
  const landmarkMap = Object.fromEntries(landmarks.map((l) => [l.id, l]));

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-primary/8 px-4 py-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground truncate">{itinerary.wish || "Your Tour"}</p>
        <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatMins(itinerary.totalDurationMinutes)}
          </span>
          <span className="flex items-center gap-1">
            <Route className="h-3.5 w-3.5" />
            {itinerary.totalDistanceKm.toFixed(1)} km
          </span>
          <span className="flex items-center gap-1">
            {itinerary.travelMode === "walking" ? (
              <Footprints className="h-3.5 w-3.5" />
            ) : (
              <Car className="h-3.5 w-3.5" />
            )}
            {itinerary.travelMode}
          </span>
        </div>
      </div>

      {/* Stop list */}
      <ol className="divide-y divide-border">
        {itinerary.stops.map((stop, i) => {
          const lm = landmarkMap[stop.landmarkId];
          return (
            <li key={stop.landmarkId}>
              {stop.travelFromPrevious && (
                <div className="flex items-center gap-1.5 px-4 py-1 bg-muted/40">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {stop.travelFromPrevious.durationMinutes}m {stop.travelFromPrevious.mode} · {stop.travelFromPrevious.distanceKm}km
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors",
                )}
                onClick={() => lm && onStopClick?.(lm.id)}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {i + 1}
                </span>
                {lm?.heroImage ? (
                  <img src={lm.heroImage} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{lm?.name ?? stop.landmarkId}</p>
                  {lm?.eyebrow && (
                    <p className="truncate text-xs text-muted-foreground">{lm.eyebrow}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatMins(stop.durationMinutes)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* LLM summary text */}
      {content && (
        <div className="border-t border-border px-4 py-3">
          <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground
              [&_p]:leading-relaxed [&_p]:mb-1.5 [&_p:last-child]:mb-0
              [&_ul]:my-1.5 [&_ul]:pl-4 [&_li]:mb-0.5
              [&_ol]:my-1.5 [&_ol]:pl-4
              [&_strong]:font-semibold [&_strong]:text-foreground
              [&_em]:text-muted-foreground/80
              [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono
              [&_table]:w-full [&_table]:text-xs [&_th]:text-left [&_th]:pb-1 [&_td]:py-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Restore button */}
      {onRestore && (
        <div className="border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={onRestore}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 py-2 text-sm font-medium",
              "text-primary bg-primary/5 hover:bg-primary/10 transition-colors",
            )}
          >
            <PenLine className="h-3.5 w-3.5" />
            Edit tour
          </button>
        </div>
      )}
    </div>
  );
}
