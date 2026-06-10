import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Languages, Globe2, LogOut, User, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile — VisitMK" }] }),
  component: ProfilePage,
});

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
    { headers: { "Accept-Language": "en" } },
  );
  if (!res.ok) throw new Error("Nominatim error");
  const data = await res.json() as {
    address?: {
      city?: string; town?: string; village?: string;
      county?: string; state?: string; country?: string;
    };
  };
  const addr = data.address ?? {};
  const locality = addr.city ?? addr.town ?? addr.village ?? addr.county ?? addr.state ?? "";
  const country = addr.country ?? "";
  return [locality, country].filter(Boolean).join(", ");
}

function ProfilePage() {
  const { user, loading, signOut } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [region, setRegion] = useState<string | null>(null);
  const [regionLoading, setRegionLoading] = useState(false);

  useEffect(() => {
    if (!user || !navigator.geolocation) return;
    setRegionLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const label = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          setRegion(label || "Unknown location");
        } catch {
          setRegion("Location unavailable");
        } finally {
          setRegionLoading(false);
        }
      },
      () => {
        setRegion("Location unavailable");
        setRegionLoading(false);
      },
      { timeout: 8000 },
    );
  }, [user]);

  if (loading) return null;

  return (
    <AppShell>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        prompt="Sign in to access your profile and preferences."
      />
      <div className="mx-auto max-w-2xl px-5 py-12 md:py-20">
        {!user ? (
          <div className="grid place-items-center py-16 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-muted">
              <User className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="mt-4 font-serif text-2xl">You're not signed in</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Sign in to save places, access your collection, and personalise your experience.
            </p>
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="mt-6 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
            >
              Sign in / Register
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/10 font-serif text-2xl text-primary">
                {user.email?.[0]?.toUpperCase() ?? "U"}
              </div>
              <div>
                <p className="eyebrow">Traveller</p>
                <h1 className="font-serif text-3xl">{user.email}</h1>
              </div>
            </div>

            <ul className="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
              <li className="flex items-center gap-4 px-5 py-4">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Language</p>
                  <p className="text-sm font-medium">English</p>
                </div>
              </li>
              <li className="flex items-center gap-4 px-5 py-4">
                <Globe2 className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Current location</p>
                  {regionLoading ? (
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Detecting…
                    </span>
                  ) : (
                    <p className="text-sm font-medium">{region ?? "—"}</p>
                  )}
                </div>
              </li>
            </ul>

            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-6 flex items-center gap-2 text-sm text-muted-foreground transition hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </>
        )}
      </div>
    </AppShell>
  );
}
