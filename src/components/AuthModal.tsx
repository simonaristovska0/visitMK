import { useState } from "react";
import { X, Mail, Lock, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  /** Message shown above the form explaining why login is needed */
  prompt?: string;
}

export function AuthModal({ open, onClose, prompt }: AuthModalProps) {
  const { signIn, signUp } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  const reset = () => {
    setEmail(""); setPassword(""); setError(null); setSuccess(false); setLoading(false);
  };

  const switchTab = (t: "signin" | "signup") => { setTab(t); reset(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    const err = tab === "signin"
      ? await signIn(email, password)
      : await signUp(email, password);
    setLoading(false);
    if (err) {
      setError(err);
    } else if (tab === "signup") {
      setSuccess(true);
    } else {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-[70] bg-foreground/40 backdrop-blur-sm"
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[71] rounded-t-3xl bg-card px-6 pb-10 pt-6 shadow-2xl animate-in slide-in-from-bottom md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md md:rounded-2xl">
        {/* Handle */}
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-border md:hidden" />

        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-serif text-2xl">
              {tab === "signin" ? "Welcome back" : "Create account"}
            </h2>
            {prompt && <p className="mt-1 text-sm text-muted-foreground">{prompt}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-5 flex rounded-xl border border-border bg-muted p-1">
          {(["signin", "signup"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => switchTab(t)}
              className={cn(
                "flex-1 rounded-lg py-2 text-sm font-medium transition",
                tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "signin" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>

        {success ? (
          <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/10 px-5 py-6 text-center">
            <p className="font-serif text-lg text-foreground">Check your inbox</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then sign in.
            </p>
            <button
              type="button"
              onClick={() => switchTab("signin")}
              className="mt-4 text-sm font-medium text-primary hover:underline"
            >
              Go to sign in →
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                required
                className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                minLength={6}
                className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-4 text-sm outline-none focus:border-primary"
              />
            </div>

            {error && (
              <p className="rounded-xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {tab === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
