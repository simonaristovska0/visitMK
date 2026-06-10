import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bookmark, Trash2, Route as RouteIcon, Clock } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/lib/auth";
import { supabase, type SavedTourRow } from "@/lib/supabase";
import type { Itinerary, Landmark } from "@/lib/types";

export const Route = createFileRoute("/saved")({
  head: () => ({ meta: [{ title: "Saved — VisitMK" }] }),
  component: SavedPage,
});

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
  const [tours, setTours] = useState<SavedTourRow[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!user) { setTours([]); return; }
    setFetching(true);
    supabase
      .from("saved_tours")
      .select("*")
      .order("saved_at", { ascending: false })
      .then(({ data }) => {
        setTours((data as SavedTourRow[]) ?? []);
        setFetching(false);
      });
  }, [user]);

  const deleteTour = async (row: SavedTourRow) => {
    await supabase.from("saved_tours").delete().eq("id", row.id);
    setTours((prev) => prev.filter((t) => t.id !== row.id));
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

  if (loading) return null;

  return (
    <AppShell>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        prompt="Sign in to see your saved tours."
      />
      <div className="mx-auto max-w-2xl px-5 py-10 md:py-16">
        <p className="eyebrow">Saved</p>
        <h1 className="mt-2 font-serif text-4xl md:text-5xl">Your tours</h1>

        {!user ? (
          <div className="mt-10 grid place-items-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <Bookmark className="h-8 w-8 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">Nothing saved yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Sign in to save tours and access them from any device.
            </p>
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
            >
              Sign in / Register
            </button>
          </div>
        ) : fetching ? (
          <div className="mt-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : tours.length === 0 ? (
          <div className="mt-10 grid place-items-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <RouteIcon className="h-8 w-8 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">No saved tours</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Ask the guide to plan a tour, then tap the bookmark icon to save it.
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {tours.map((row) => {
              const itin = row.itinerary as Itinerary;
              const landmarks = row.landmarks as Landmark[];
              const thumbs = landmarks.slice(0, 3).map((l) => l.heroImage).filter(Boolean);
              return (
                <li key={row.id} className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                  {thumbs.length > 0 && (
                    <div className="flex h-20 gap-0.5">
                      {thumbs.map((src, i) => (
                        <img key={i} src={src} alt="" className="flex-1 object-cover min-w-0" />
                      ))}
                    </div>
                  )}
                  <div className="flex items-start gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-base leading-snug truncate">{row.name}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {fmt(itin.totalDurationMinutes)}
                        </span>
                        <span className="flex items-center gap-1">
                          <RouteIcon className="h-3 w-3" />
                          {itin.totalDistanceKm.toFixed(1)} km
                        </span>
                        <span>{itin.stops.length} stops</span>
                      </div>
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => loadTourOnMap(row)}
                          className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
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
        )}
      </div>
    </AppShell>
  );
}
