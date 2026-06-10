import { useState, useCallback } from "react";
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
import { GripVertical, X, Footprints, Car, Route, Loader2 } from "lucide-react";
import type { Itinerary, Landmark, TravelMode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RouteBuilderProps {
  availableLandmarks: Landmark[];   // all visible pins on the map
  onBuildRoute: (landmarks: Landmark[], mode: TravelMode) => Promise<void>;
  itinerary?: Itinerary | null;
  isBuilding?: boolean;
  onClose: () => void;
}

function formatMins(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Sortable stop item ────────────────────────────────────────────────────────

function SortableStop({ lm, index, onRemove }: { lm: Landmark; index: number; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lm.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-xl bg-card border border-border px-3 py-2.5 shadow-sm">
      <button type="button" {...attributes} {...listeners} className="text-muted-foreground cursor-grab active:cursor-grabbing">
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {index + 1}
      </span>
      {lm.heroImage ? (
        <img src={lm.heroImage} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{lm.name}</p>
        {lm.eyebrow && <p className="truncate text-xs text-muted-foreground">{lm.eyebrow}</p>}
      </div>
      <button
        type="button"
        onClick={() => onRemove(lm.id)}
        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
        aria-label={`Remove ${lm.name}`}
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

// ── RouteBuilder ─────────────────────────────────────────────────────────────

export function RouteBuilder({
  availableLandmarks,
  onBuildRoute,
  itinerary,
  isBuilding,
  onClose,
}: RouteBuilderProps) {
  const [stops, setStops] = useState<Landmark[]>([]);
  const [travelMode, setTravelMode] = useState<TravelMode>("walking");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setStops((prev) => {
        const oldIndex = prev.findIndex((l) => l.id === active.id);
        const newIndex = prev.findIndex((l) => l.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, []);

  const addStop = useCallback((lm: Landmark) => {
    setStops((prev) => {
      if (prev.find((s) => s.id === lm.id)) return prev;
      return [...prev, lm];
    });
  }, []);

  const removeStop = useCallback((id: string) => {
    setStops((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const notAdded = availableLandmarks.filter((lm) => !stops.find((s) => s.id === lm.id));

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-serif font-semibold">Create route</h2>
          <p className="text-xs text-muted-foreground">Drag stops to reorder</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Current stops */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {stops.map((lm, i) => (
                <SortableStop key={lm.id} lm={lm} index={i} onRemove={removeStop} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {stops.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">Add places from the list below</p>
          </div>
        )}

        {/* Available pins to add */}
        {notAdded.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Visible pins — tap to add
            </p>
            <ul className="space-y-1.5">
              {notAdded.slice(0, 20).map((lm) => (
                <li key={lm.id}>
                  <button
                    type="button"
                    onClick={() => addStop(lm)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted transition-colors"
                  >
                    {lm.heroImage ? (
                      <img src={lm.heroImage} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{lm.name}</p>
                      {lm.eyebrow && <p className="truncate text-xs text-muted-foreground">{lm.eyebrow}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer controls */}
      <div className="border-t border-border px-4 py-3 space-y-3">
        {/* Travel mode toggle */}
        <div className="flex gap-2">
          {(["walking", "driving"] as TravelMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setTravelMode(mode)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors",
                travelMode === mode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "walking" ? <Footprints className="h-4 w-4" /> : <Car className="h-4 w-4" />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Route summary (if built) */}
        {itinerary && (
          <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Route className="h-3.5 w-3.5" />
              {itinerary.totalDistanceKm.toFixed(1)} km
            </span>
            <span>{formatMins(itinerary.totalDurationMinutes)} total</span>
          </div>
        )}

        {/* Calculate button */}
        <button
          type="button"
          disabled={stops.length < 2 || isBuilding}
          onClick={() => onBuildRoute(stops, travelMode)}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors",
            "bg-primary text-primary-foreground hover:opacity-90",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {isBuilding ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Calculating…</>
          ) : (
            <><Route className="h-4 w-4" /> Calculate route</>
          )}
        </button>
      </div>
    </div>
  );
}
