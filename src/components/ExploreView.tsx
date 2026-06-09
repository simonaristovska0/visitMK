import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Locate, Home, ChevronRight, Loader2 } from "lucide-react";
import type { Category, Coordinates, Landmark } from "@/lib/types";
import { getTopRestaurants, getTopAttractions } from "@/lib/api/places.functions";
import { MapView } from "@/components/MapView";
import { LandmarkDetail } from "@/components/LandmarkDetail";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ id: "all" | Category; label: string }> = [
  { id: "all", label: "All" },
  { id: "landmark", label: "Landmarks" },
  { id: "food", label: "Restaurants" },
  { id: "cafe", label: "Cafés" },
  { id: "shopping", label: "Shopping" },
  { id: "culture", label: "Culture" },
  { id: "outdoors", label: "Outdoors" },
];

// Simulated user location, central Skopje
const USER_LOCATION: Coordinates = { lat: 41.9973, lng: 21.428 };

function distMeters(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function formatM(m: number) {
  return m < 1000 ? `${m}M` : `${(m / 1000).toFixed(1)}KM`;
}

export function ExploreView() {
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: restaurantData, isLoading: loadingRestaurants } = useQuery({
    queryKey: ["top-restaurants"],
    queryFn: () => getTopRestaurants(),
    staleTime: 60 * 60 * 1000,
  });

  const { data: attractionData, isLoading: loadingAttractions } = useQuery({
    queryKey: ["top-attractions"],
    queryFn: () => getTopAttractions(),
    staleTime: 6 * 60 * 60 * 1000,
  });

  const allLandmarks: Landmark[] = useMemo(() => {
    const restaurants = restaurantData?.restaurants ?? [];
    const attractions = attractionData?.attractions ?? [];
    return [...attractions, ...restaurants].map((l) => ({
      ...l,
      walkTimeMinutes: Math.max(1, Math.ceil(distMeters(USER_LOCATION, l.coordinates) / 83.3)),
    }));
  }, [restaurantData, attractionData]);

  const filtered = useMemo(
    () => (filter === "all" ? allLandmarks : allLandmarks.filter((l) => l.category === filter)),
    [filter, allLandmarks],
  );

  const nearest = useMemo(() => {
    return [...filtered]
      .map((l) => ({ l, d: distMeters(USER_LOCATION, l.coordinates) }))
      .sort((a, b) => a.d - b.d)[0];
  }, [filtered]);

  const pins = useMemo(() => filtered.map((l) => ({ landmark: l })), [filtered]);

  // Build a lookup for all visible landmarks (for LandmarkDetail)
  const landmarkById = useMemo(
    () => Object.fromEntries(allLandmarks.map((l) => [l.id, l])),
    [allLandmarks],
  );

  return (
    <>
      <div className="relative h-[calc(100vh-5rem)] md:h-screen">
        <MapView
          pins={pins}
          userLocation={USER_LOCATION}
          selectedId={selectedId ?? undefined}
          onPinClick={(id) => setSelectedId(id)}
          className="h-full w-full"
        />

        {/* Top banner: nearest POI */}
        {nearest && (
          <button
            type="button"
            onClick={() => setSelectedId(nearest.l.id)}
            className="absolute inset-x-4 top-4 z-20 flex items-center gap-3 rounded-2xl bg-card/95 px-4 py-3 text-left shadow-lg backdrop-blur transition hover:bg-card md:left-6 md:right-auto md:max-w-md"
          >
            <div className="grid h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted">
              {nearest.l.heroImage ? (
                <img src={nearest.l.heroImage} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-cat-food/20" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold tracking-[0.18em] text-primary">
                {formatM(nearest.d)} AWAY · TAP TO EXPLORE
              </p>
              <p className="mt-0.5 truncate font-serif text-base leading-tight">{nearest.l.name}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </button>
        )}

        {/* Floating action buttons */}
        <div className="absolute right-4 top-24 z-20 flex flex-col gap-2 md:right-6">
          <FabButton label="Search"><Search className="h-4 w-4" /></FabButton>
          <FabButton label="My location"><Locate className="h-4 w-4" /></FabButton>
          <FabButton label="Home"><Home className="h-4 w-4" /></FabButton>
        </div>

        {/* Nearby pill — shows spinner while data loads */}
        <div className="absolute left-1/2 z-20 -translate-x-1/2 bottom-24 md:bottom-28">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background shadow-lg">
            {loadingRestaurants || loadingAttractions ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            )}
            {filtered.length} nearby
          </span>
        </div>

        {/* Filter chips */}
        <div className="absolute inset-x-0 bottom-4 z-20">
          <div className="scrollbar-hide flex gap-2 overflow-x-auto px-4 md:justify-center md:px-6">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition shadow-sm backdrop-blur",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card/95 text-foreground hover:border-primary/40",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
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

function FabButton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-full bg-card/95 text-foreground shadow-lg backdrop-blur transition hover:bg-card hover:text-primary"
    >
      {children}
    </button>
  );
}
