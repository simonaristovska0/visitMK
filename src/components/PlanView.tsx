import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  MapPin,
  Footprints,
  Car,
  RotateCcw,
  Sparkles,
  Pencil,
  Loader2,
} from "lucide-react";
import type { Coordinates, Landmark, TravelMode } from "@/lib/types";
import { getTopAttractions } from "@/lib/api/places.functions";
import { buildItinerary } from "@/lib/api/itinerary.functions";
import { planTour } from "@/lib/api/tour.functions";
import { MapView } from "@/components/MapView";
import { LandmarkDetail } from "@/components/LandmarkDetail";
import { CategoryBadge } from "@/components/CategoryBadge";
import { formatDuration, formatDistance } from "@/lib/format";
import { cn } from "@/lib/utils";

const SKOPJE_CENTER: Coordinates = { lat: 41.9973, lng: 21.428 };
const DEFAULT_STOPS = 5;

function distMeters(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function PlanView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<TravelMode>("walking");
  const [wish, setWish] = useState("A morning exploring the landmarks of Skopje");
  const [editing, setEditing] = useState(false);
  const [aiLandmarkIds, setAiLandmarkIds] = useState<string[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);

  // ── Fetch attractions (shared cache key with ExploreView) ───────────────
  const { data: attractionData, isLoading: landmarksLoading } = useQuery({
    queryKey: ["top-attractions"],
    queryFn: () => getTopAttractions(),
    staleTime: 6 * 60 * 60 * 1000,
  });

  // When user submits a wish, ask Gemini which landmarks to include
  const applyWish = async () => {
    setEditing(false);
    setAiError(false);
    const all = attractionData?.attractions;
    if (!all?.length) return;
    setAiLoading(true);
    try {
      const result = await planTour({
        data: {
          wish,
          landmarks: all.map((l) => ({
            id: l.id,
            name: l.name,
            category: l.category,
            description: (l.history ?? l.eyebrow ?? "").slice(0, 150),
            lat: l.coordinates.lat,
            lng: l.coordinates.lng,
          })),
        },
      });
      setAiLandmarkIds(result.ids);
    } catch (err) {
      console.error("planTour failed:", err);
      setAiError(true);
    } finally {
      setAiLoading(false);
    }
  };

  // AI-selected landmarks when available; otherwise nearest non-food default
  const featuredLandmarks: Landmark[] = useMemo(() => {
    const all = attractionData?.attractions ?? [];
    if (aiLandmarkIds?.length) {
      return aiLandmarkIds
        .map((id) => all.find((l) => l.id === id))
        .filter((l): l is Landmark => l != null);
    }
    return [...all]
      .filter((l) => l.category !== "food" && l.category !== "cafe")
      .map((l) => ({ l, d: distMeters(SKOPJE_CENTER, l.coordinates) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, DEFAULT_STOPS)
      .map(({ l }) => l);
  }, [attractionData, aiLandmarkIds]);

  const waypointKey = featuredLandmarks.map((l) => l.id).join(",");

  // ── Build optimised itinerary (re-runs when mode or stop set changes) ────
  const { data: itineraryData, isLoading: buildingItinerary, refetch } = useQuery({
    queryKey: ["itinerary", mode, waypointKey],
    queryFn: () =>
      buildItinerary({
        data: {
          waypoints: featuredLandmarks.map((l) => ({
            id: l.id,
            coordinates: l.coordinates,
            category: l.category,
          })),
          travelMode: mode,
          wish,
        },
      }),
    enabled: featuredLandmarks.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  // ── Derived display data ─────────────────────────────────────────────────
  const landmarkById = useMemo(
    () =>
      Object.fromEntries(
        (attractionData?.attractions ?? []).map((l) => [l.id, l]),
      ) as Record<string, Landmark>,
    [attractionData],
  );

  const itinerary = itineraryData?.itinerary;
  const stops = itinerary?.stops ?? [];

  const routeIds = stops.map((s) => s.landmarkId);
  const routePins = stops
    .map((s) => ({ landmark: landmarkById[s.landmarkId], order: s.order }))
    .filter((p): p is { landmark: Landmark; order: number } => p.landmark != null);

  const loading = landmarksLoading || buildingItinerary;

  return (
    <>
      <div className="md:grid md:h-screen md:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
        {/* Map area */}
        <div className="relative h-[44vh] md:h-screen md:min-h-0">
          <MapView
            pins={routePins}
            routeIds={routeIds}
            travelMode={mode}
            selectedId={selectedId ?? undefined}
            onPinClick={(id) => setSelectedId(id)}
            className="h-full w-full"
          />
          {/* Map header */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
            <button
              type="button"
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-card/95 px-3.5 py-2 text-sm font-medium shadow-md backdrop-blur transition hover:bg-card"
            >
              <MapPin className="h-4 w-4 text-primary" />
              Skopje
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="pointer-events-auto flex rounded-full bg-card/95 p-1 shadow-md backdrop-blur">
              <ModeButton active={mode === "walking"} onClick={() => setMode("walking")}>
                <Footprints className="h-4 w-4" />
              </ModeButton>
              <ModeButton active={mode === "driving"} onClick={() => setMode("driving")}>
                <Car className="h-4 w-4" />
              </ModeButton>
            </div>
          </div>
        </div>

        {/* Itinerary panel */}
        <div className="relative -mt-6 rounded-t-3xl bg-background md:mt-0 md:overflow-y-auto md:rounded-none md:border-l md:border-border">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border md:hidden" />

          <div className="px-5 pb-6 pt-4 md:px-8 md:pt-8">
            {/* Wish card */}
            <p className="eyebrow">Your wish</p>
            <div className="mt-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  {aiLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </div>
                {editing ? (
                  <textarea
                    value={wish}
                    onChange={(e) => setWish(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void applyWish(); } }}
                    autoFocus
                    rows={2}
                    className="flex-1 resize-none bg-transparent text-[15px] leading-snug outline-none"
                  />
                ) : (
                  <p className="flex-1 text-[15px] leading-snug text-foreground/90">"{wish}"</p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (editing) { void applyWish(); }
                    else if (aiError) { void applyWish(); }
                    else { setEditing(true); }
                  }}
                  disabled={aiLoading}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  aria-label={editing || aiError ? "Apply wish" : "Edit wish"}
                >
                  {editing || aiError ? <Sparkles className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                </button>
              </div>
              {aiError && (
                <p className="mt-2 text-xs text-destructive">AI is busy — tap the sparkle to retry.</p>
              )}
              {aiLoading && (
                <p className="mt-2 text-xs text-muted-foreground">AI is picking the best stops for you…</p>
              )}
            </div>

            {/* Route summary */}
            <div className="mt-5 flex items-center justify-between">
              <div>
                <p className="eyebrow">Today's route</p>
                {loading ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Building route…
                  </div>
                ) : itinerary ? (
                  <p className="mt-1 text-sm text-foreground/80">
                    <span className="font-semibold">{stops.length} stops</span>
                    <span className="text-muted-foreground"> · </span>
                    {formatDuration(itinerary.totalDurationMinutes)}
                    <span className="text-muted-foreground"> · </span>
                    {formatDistance(itinerary.totalDistanceKm)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition hover:border-primary/40 hover:text-primary disabled:opacity-40"
              >
                <RotateCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Re-plan
              </button>
            </div>

            {/* Stops list */}
            {loading ? (
              <StopsSkeleton />
            ) : (
              <ol className="mt-4 space-y-3">
                {stops.map((stop) => {
                  const lm = landmarkById[stop.landmarkId];
                  if (!lm) return null;
                  return (
                    <li key={stop.landmarkId}>
                      {stop.travelFromPrevious ? (
                        <div className="ml-7 flex items-center gap-2 py-1 pl-2 text-xs text-muted-foreground">
                          <span className="h-3 w-px bg-border" />
                          {mode === "driving" ? (
                            <Car className="h-3.5 w-3.5" />
                          ) : (
                            <Footprints className="h-3.5 w-3.5" />
                          )}
                          +{formatDistance(stop.travelFromPrevious.distanceKm)} ·{" "}
                          {formatDuration(stop.travelFromPrevious.durationMinutes)}
                        </div>
                      ) : (
                        <div className="ml-7 flex items-center gap-2 py-1 pl-2 text-xs font-semibold uppercase tracking-wider text-accent">
                          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                          Start
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedId(lm.id)}
                        className="group flex w-full gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
                      >
                        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                          {lm.heroImage && (
                            <img
                              src={lm.heroImage}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          )}
                          <div className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-card/95 text-[11px] font-bold text-foreground shadow">
                            {stop.order}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1 py-0.5">
                          <h3 className="truncate font-serif text-lg leading-snug">{lm.name}</h3>
                          <div className="mt-1 flex items-center gap-2">
                            <CategoryBadge category={lm.category} />
                            <span className="text-xs text-muted-foreground">
                              {formatDuration(stop.durationMinutes)}
                            </span>
                          </div>
                          {lm.nameCyrillic && (
                            <p className="mt-1 truncate font-serif text-xs italic text-muted-foreground">
                              {lm.nameCyrillic}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}

            <p className="mt-6 text-center text-xs text-muted-foreground">
              {attractionData?.attractions.length ?? "…"} curated places in this region
            </p>
          </div>
        </div>
      </div>

      <LandmarkDetail
        landmark={selectedId ? (landmarkById[selectedId] ?? null) : null}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid h-8 w-9 place-items-center rounded-full text-sm transition",
        active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function StopsSkeleton() {
  return (
    <ol className="mt-4 space-y-3">
      {Array.from({ length: 4 }, (_, i) => i).map((i) => (
        <li key={i}>
          <div className="ml-7 h-4 w-32 animate-pulse rounded bg-muted py-1" />
          <div className="mt-1 flex gap-3 rounded-2xl border border-border bg-card p-3">
            <div className="h-20 w-20 shrink-0 animate-pulse rounded-xl bg-muted" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
