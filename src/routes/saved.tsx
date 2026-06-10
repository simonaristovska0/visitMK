import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bookmark, Trash2, Route as RouteIcon, Clock, Star, MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthModal } from "@/components/AuthModal";
import { CategoryBadge } from "@/components/CategoryBadge";
import { useAuth } from "@/lib/auth";
import { supabase, type SavedTourRow, type SavedLandmarkRow } from "@/lib/supabase";
import type { Itinerary, Landmark } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/saved")({
  head: () => ({ meta: [{ title: "Saved — VisitMK" }] }),
  component: SavedPage,
});

type ActiveTab = "tours" | "places";

function fmt(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function SavedPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("tours");

  // ── Tours state ──────────────────────────────────────────────────────────────
  const [tours, setTours] = useState<SavedTourRow[]>([]);
  const [toursFetching, setToursFetching] = useState(false);

  // ── Places state ─────────────────────────────────────────────────────────────
  const [places, setPlaces] = useState<SavedLandmarkRow[]>([]);
  const [placesFetching, setPlacesFetching] = useState(false);

  useEffect(() => {
    if (!user) { setTours([]); setPlaces([]); return; }

    setToursFetching(true);
    supabase
      .from("saved_tours")
      .select("*")
      .order("saved_at", { ascending: false })
      .then(({ data }) => {
        setTours((data as SavedTourRow[]) ?? []);
        setToursFetching(false);
      });

    setPlacesFetching(true);
    supabase
      .from("saved_landmarks")
      .select("*")
      .order("saved_at", { ascending: false })
      .then(({ data }) => {
        setPlaces((data as SavedLandmarkRow[]) ?? []);
        setPlacesFetching(false);
      });
  }, [user]);

  const deleteTour = async (row: SavedTourRow) => {
    await supabase.from("saved_tours").delete().eq("id", row.id);
    setTours((prev) => prev.filter((t) => t.id !== row.id));
  };

  const deletePlace = async (row: SavedLandmarkRow) => {
    await supabase.from("saved_landmarks").delete().eq("id", row.id);
    setPlaces((prev) => prev.filter((p) => p.id !== row.id));
  };

  const loadTourOnMap = (row: SavedTourRow) => {
    try {
      sessionStorage.setItem(
        "vmk_load_tour",
        JSON.stringify({ itinerary: row.itinerary, landmarks: row.landmarks }),
      );
    } catch {}
    navigate({ to: "/" });
  };

  const showPlaceOnMap = (row: SavedLandmarkRow) => {
    try {
      sessionStorage.setItem("vmk_view_landmark", JSON.stringify(row.landmark_data));
    } catch {}
    navigate({ to: "/" });
  };

  if (loading) return null;

  return (
    <AppShell>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        prompt="Sign in to see your saved items."
      />
      <div className="mx-auto max-w-2xl px-5 py-10 md:py-16">
        <p className="eyebrow">Saved</p>
        <h1 className="mt-2 font-serif text-4xl md:text-5xl">Your collection</h1>

        {!user ? (
          <div className="mt-10 grid place-items-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <Bookmark className="h-8 w-8 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">Nothing saved yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Sign in to save tours and places, and access them from any device.
            </p>
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
            >
              Sign in / Register
            </button>
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="mt-8 flex gap-1 rounded-2xl border border-border bg-muted/40 p-1">
              {(["tours", "places"] as ActiveTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "flex-1 rounded-xl py-2 text-sm font-medium transition-colors",
                    activeTab === tab
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab === "tours" ? "Tours" : "Places"}
                </button>
              ))}
            </div>

            {/* ── Tours tab ─────────────────────────────────────────────────── */}
            {activeTab === "tours" && (
              toursFetching ? (
                <div className="mt-6 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />
                  ))}
                </div>
              ) : tours.length === 0 ? (
                <div className="mt-8 grid place-items-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
                  <RouteIcon className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-4 font-serif text-xl">No saved tours</p>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    Ask the guide to plan a tour, then tap the bookmark icon to save it.
                  </p>
                </div>
              ) : (
                <ul className="mt-6 space-y-3">
                  {tours.map((row) => {
                    const itin = row.itinerary as Itinerary;
                    const landmarks = row.landmarks as Landmark[];
                    const thumbs = landmarks
                      .filter((l) => l.id !== "user_location")
                      .slice(0, 3)
                      .map((l) => l.heroImage)
                      .filter(Boolean);
                    const realStops = itin.stops.filter((s) => s.landmarkId !== "user_location");
                    return (
                      <li key={row.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                        {thumbs.length > 0 && (
                          <div className="flex h-20 gap-0.5">
                            {thumbs.map((src, i) => (
                              <img key={i} src={src} alt="" className="min-w-0 flex-1 object-cover" />
                            ))}
                          </div>
                        )}
                        <div className="flex items-start gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-serif text-base leading-snug">{row.name}</p>
                            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {fmt(itin.totalDurationMinutes)}
                              </span>
                              <span className="flex items-center gap-1">
                                <RouteIcon className="h-3 w-3" />
                                {itin.totalDistanceKm.toFixed(1)} km
                              </span>
                              <span>{realStops.length} stops</span>
                            </div>
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => loadTourOnMap(row)}
                                className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                              >
                                Load on map
                              </button>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteTour(row)}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Delete tour"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            )}

            {/* ── Places tab ────────────────────────────────────────────────── */}
            {activeTab === "places" && (
              placesFetching ? (
                <div className="mt-6 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
                  ))}
                </div>
              ) : places.length === 0 ? (
                <div className="mt-8 grid place-items-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
                  <MapPin className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-4 font-serif text-xl">No saved places</p>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    Tap the bookmark icon on any place to save it here.
                  </p>
                </div>
              ) : (
                <ul className="mt-6 space-y-3">
                  {places.map((row) => {
                    const lm = row.landmark_data as Landmark;
                    return (
                      <li key={row.id} className="flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-card shadow-sm p-3">
                        {/* Thumbnail */}
                        {lm.heroImage ? (
                          <img
                            src={lm.heroImage}
                            alt=""
                            className="h-16 w-16 shrink-0 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-muted">
                            <MapPin className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-serif text-base leading-snug">{lm.name}</p>
                          {lm.eyebrow && (
                            <p className="truncate text-xs text-muted-foreground">{lm.eyebrow}</p>
                          )}
                          <div className="mt-1.5 flex items-center gap-2">
                            <CategoryBadge category={lm.category} />
                            {lm.rating > 0 && (
                              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                                <Star className="h-3 w-3 fill-cat-landmark text-cat-landmark" />
                                {lm.rating.toFixed(1)}
                              </span>
                            )}
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => showPlaceOnMap(row)}
                              className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                            >
                              Show on map
                            </button>
                          </div>
                        </div>

                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => deletePlace(row)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Remove place"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
