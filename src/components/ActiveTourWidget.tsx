import { useState, useCallback, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronUp,
  ChevronDown,
  X,
  GripVertical,
  Clock,
  Route,
  Footprints,
  Car,
  RefreshCw,
  Plus,
  Loader2,
  Bookmark,
  BookmarkCheck,
} from "lucide-react";
import type { Itinerary, Landmark, TravelMode } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Sortable stop row ─────────────────────────────────────────────────────────

function SortableStopRow({
  lm,
  index,
  visitDurationMinutes,
  travelLegBefore,
  isDirty,
  onClick,
}: {
  lm: Landmark;
  index: number;
  visitDurationMinutes: number;
  travelLegBefore?: { durationMinutes: number; distanceKm: number; mode: TravelMode };
  isDirty: boolean;
  onClick: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lm.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 }}
    >
      {/* Travel leg divider */}
      {index > 0 && (
        <div className="flex items-center gap-2 py-1.5 px-2">
          <span className="h-px flex-1 bg-border/60" />
          {isDirty ? (
            <span className="text-[10px] text-muted-foreground/60 italic">recalculate to update</span>
          ) : travelLegBefore ? (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {travelLegBefore.mode === "walking" ? "🚶" : "🚗"}{" "}
              {fmt(travelLegBefore.durationMinutes)} · {travelLegBefore.distanceKm} km
            </span>
          ) : null}
          <span className="h-px flex-1 bg-border/60" />
        </div>
      )}

      {/* Stop row */}
      <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-muted/40 group">
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Order badge */}
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {index + 1}
        </span>

        {/* Thumbnail */}
        <button type="button" onClick={() => onClick(lm.id)} className="contents">
          {lm.heroImage ? (
            <img src={lm.heroImage} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-lg bg-muted" />
          )}

          {/* Name + address */}
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-medium leading-tight">{lm.name}</p>
            {lm.eyebrow && (
              <p className="truncate text-[11px] text-muted-foreground">{lm.eyebrow}</p>
            )}
          </div>
        </button>

        {/* Visit duration */}
        <span className="shrink-0 text-xs text-muted-foreground">
          {fmt(visitDurationMinutes)}
        </span>
      </div>
    </li>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

const QUICK_ADDS = [
  { label: "Add a café stop", message: "Add a nice café stop to my current tour route" },
  { label: "Add a restaurant", message: "Add a highly rated restaurant to my current tour route" },
  { label: "Add a landmark", message: "Add an interesting landmark or attraction to my current tour route" },
];

interface ActiveTourWidgetProps {
  itinerary: Itinerary;
  landmarks: Landmark[];
  onRecalculate: (orderedLandmarks: Landmark[], mode: TravelMode) => Promise<void>;
  onClose: () => void;
  onStopClick?: (id: string) => void;
  onQuickAdd?: (message: string) => void;
  onSave?: () => void;
  isRecalculating?: boolean;
  isSaving?: boolean;
  isSaved?: boolean;
}

export function ActiveTourWidget({
  itinerary,
  landmarks,
  onRecalculate,
  onClose,
  onStopClick,
  onQuickAdd,
  onSave,
  isRecalculating,
  isSaving,
  isSaved,
}: ActiveTourWidgetProps) {
  const [expanded, setExpanded] = useState(true);
  const [travelMode, setTravelMode] = useState<TravelMode>(itinerary.travelMode);
  const [localStops, setLocalStops] = useState<Landmark[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  // Build ordered landmark list from itinerary whenever it changes
  useEffect(() => {
    const ordered = itinerary.stops
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => landmarks.find((l) => l.id === s.landmarkId))
      .filter((l): l is Landmark => l != null);
    setLocalStops(ordered);
    setTravelMode(itinerary.travelMode);
    setIsDirty(false);
  }, [itinerary, landmarks]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setLocalStops((prev) => {
        const oldIdx = prev.findIndex((l) => l.id === active.id);
        const newIdx = prev.findIndex((l) => l.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
      setIsDirty(true);
    }
  }, []);

  const handleModeChange = useCallback((mode: TravelMode) => {
    setTravelMode(mode);
    setIsDirty(true);
  }, []);

  const handleRecalculate = useCallback(async () => {
    await onRecalculate(localStops, travelMode);
    setIsDirty(false);
  }, [onRecalculate, localStops, travelMode]);

  const totalVisitMinutes = itinerary.stops.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalTravelMinutes = itinerary.totalDurationMinutes - totalVisitMinutes;

  // ── Collapsed pill ────────────────────────────────────────────────────────

  if (!expanded) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-card/95 backdrop-blur border border-border shadow-lg px-4 py-3">
        <Route className="h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold">{itinerary.wish || "Active tour"}</p>
          <p className="text-xs text-muted-foreground">
            {localStops.length} stops · {fmt(itinerary.totalDurationMinutes)} · {itinerary.totalDistanceKm.toFixed(1)} km
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="shrink-0 rounded-lg p-1.5 hover:bg-muted transition-colors"
          aria-label="Expand tour"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || isSaved}
            className={cn(
              "shrink-0 rounded-lg p-1.5 transition-colors",
              isSaved ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-primary",
              isSaving && "opacity-50",
            )}
            aria-label={isSaved ? "Tour saved" : "Save tour"}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isSaved ? (
              <BookmarkCheck className="h-4 w-4" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 hover:bg-muted transition-colors text-muted-foreground"
          aria-label="Close tour"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Expanded panel ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col rounded-2xl bg-card/97 backdrop-blur border border-border shadow-xl overflow-hidden max-h-[70vh]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Route className="h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold">{itinerary.wish || "Active tour"}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{fmt(itinerary.totalDurationMinutes)}</span>
            <span>·</span>
            <span>{itinerary.totalDistanceKm.toFixed(1)} km</span>
            <span>·</span>
            <span>{localStops.length} stops</span>
          </div>
          <div className="text-[11px] text-muted-foreground/70 mt-0.5">
            {fmt(totalVisitMinutes)} at stops · {fmt(totalTravelMinutes)} travel
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="shrink-0 rounded-lg p-1.5 hover:bg-muted transition-colors"
          aria-label="Collapse"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || isSaved}
            className={cn(
              "shrink-0 rounded-lg p-1.5 transition-colors",
              isSaved ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-primary",
              isSaving && "opacity-50",
            )}
            aria-label={isSaved ? "Tour saved" : "Save tour"}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isSaved ? (
              <BookmarkCheck className="h-4 w-4" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 hover:bg-muted transition-colors text-muted-foreground"
          aria-label="Close tour"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable stop list */}
      <div className="overflow-y-auto flex-1 px-3 py-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={localStops.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            <ul>
              {localStops.map((lm, i) => {
                // Find the original travel leg for this stop position (only valid when not dirty)
                const originalStop = itinerary.stops.find((s) => s.landmarkId === lm.id);
                const leg = !isDirty ? originalStop?.travelFromPrevious : undefined;
                return (
                  <SortableStopRow
                    key={lm.id}
                    lm={lm}
                    index={i}
                    visitDurationMinutes={originalStop?.durationMinutes ?? 30}
                    travelLegBefore={leg}
                    isDirty={isDirty && i > 0}
                    onClick={(id) => onStopClick?.(id)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      </div>

      {/* Controls */}
      <div className="border-t border-border px-4 py-3 space-y-3 shrink-0">
        {/* Travel mode */}
        <div className="flex gap-2">
          {(["walking", "driving"] as TravelMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleModeChange(mode)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition-colors",
                travelMode === mode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "walking" ? <Footprints className="h-3.5 w-3.5" /> : <Car className="h-3.5 w-3.5" />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Recalculate — shown when order or mode changed */}
        {isDirty && (
          <button
            type="button"
            onClick={handleRecalculate}
            disabled={isRecalculating}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors",
              "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50",
            )}
          >
            {isRecalculating
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Recalculating…</>
              : <><RefreshCw className="h-4 w-4" /> Recalculate route</>}
          </button>
        )}

        {/* Quick-add suggestions */}
        {onQuickAdd && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Suggestions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_ADDS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => onQuickAdd(q.message)}
                  className="flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary active:bg-primary/20 active:scale-95"
                >
                  <Plus className="h-3 w-3 text-primary" />
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
