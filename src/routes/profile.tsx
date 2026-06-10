import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Settings, Languages, Globe2, LogOut, User } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile — VisitMK" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, loading, signOut } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);

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
              {[
                { icon: Languages, label: "Language", value: "English" },
                { icon: Globe2, label: "Region", value: "Skopje, North Macedonia" }
              ].map(({ icon: Icon, label, value }) => (
                <li key={label} className="flex items-center gap-4 px-5 py-4">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className="text-sm font-medium">{value}</p>
                  </div>
                </li>
              ))}
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
