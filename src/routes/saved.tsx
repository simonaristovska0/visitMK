import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bookmark, Trash2, Navigation } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthModal } from "@/components/AuthModal";
import { CategoryBadge } from "@/components/CategoryBadge";
import { useAuth } from "@/lib/auth";
import { supabase, type SavedLandmarkRow } from "@/lib/supabase";
import type { Landmark } from "@/lib/types";

export const Route = createFileRoute("/saved")({
  head: () => ({ meta: [{ title: "Saved — VisitMK" }] }),
  component: SavedPage,
});

function SavedPage() {
  const { user, loading } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [saves, setSaves] = useState<SavedLandmarkRow[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!user) { setSaves([]); return; }
    setFetching(true);
    supabase
      .from("saved_landmarks")
      .select("*")
      .order("saved_at", { ascending: false })
      .then(({ data }) => {
        setSaves((data as SavedLandmarkRow[]) ?? []);
        setFetching(false);
      });
  }, [user]);

  const unsave = async (row: SavedLandmarkRow) => {
    await supabase.from("saved_landmarks").delete().eq("id", row.id);
    setSaves((prev) => prev.filter((s) => s.id !== row.id));
  };

  if (loading) return null;

  return (
    <AppShell>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        prompt="Sign in to see your saved places."
      />
      <div className="mx-auto max-w-2xl px-5 py-10 md:py-16">
        <p className="eyebrow">Saved</p>
        <h1 className="mt-2 font-serif text-4xl md:text-5xl">Your collection</h1>

        {!user ? (
          <div className="mt-10 grid place-items-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <Bookmark className="h-8 w-8 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">Nothing saved yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Sign in to save places and access them from any device.
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
          <div className="mt-10 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : saves.length === 0 ? (
          <div className="mt-10 grid place-items-center rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <Bookmark className="h-8 w-8 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">Nothing saved yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Tap the bookmark on any landmark to keep it for later.
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {saves.map((row) => {
              const lm = row.landmark_data as Landmark;
              return (
                <li key={row.id} className="flex gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {lm.heroImage && (
                      <img src={lm.heroImage} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 py-0.5">
                    <h3 className="truncate font-serif text-lg leading-snug">{lm.name}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <CategoryBadge category={lm.category} />
                      {lm.eyebrow && (
                        <span className="truncate text-xs text-muted-foreground">{lm.eyebrow}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end justify-between py-0.5">
                    <button
                      type="button"
                      onClick={() => unsave(row)}
                      className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${lm.coordinates.lat},${lm.coordinates.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                      aria-label="Directions"
                    >
                      <Navigation className="h-3.5 w-3.5" />
                    </a>
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
