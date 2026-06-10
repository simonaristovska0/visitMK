import { useEffect, useState } from "react";
import { Heart, Star, Footprints, X, Bookmark, Clock, Banknote, MapPin, Phone, Globe, Loader2 } from "lucide-react";
import type { Landmark, PlaceReview } from "@/lib/types";
import { CategoryBadge } from "./CategoryBadge";
import { AskAIChat } from "./AskAIChat";
import { AuthModal } from "./AuthModal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchPlaceReviews } from "@/lib/api/reviews.functions";

type Tab = "reviews" | "practical" | "ask";

interface LandmarkDetailProps {
  landmark: Landmark | null;
  onClose: () => void;
}

export function LandmarkDetail({ landmark, onClose }: LandmarkDetailProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("reviews");
  const [saved, setSaved] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [liveReviews, setLiveReviews] = useState<PlaceReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  useEffect(() => {
    setTab("reviews");
    setSaved(false);
    setLiveReviews([]);
  }, [landmark?.id]);

  // Fetch fresh reviews from Google Places API whenever a landmark is opened
  useEffect(() => {
    if (!landmark?.id || landmark.id === "user_location") return;
    let cancelled = false;
    setReviewsLoading(true);
    fetchPlaceReviews({ data: { placeId: landmark.id } })
      .then(({ reviews }) => { if (!cancelled) setLiveReviews(reviews); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReviewsLoading(false); });
    return () => { cancelled = true; };
  }, [landmark?.id]);

  // Check if this landmark is already saved when user/landmark changes
  useEffect(() => {
    if (!user || !landmark) { setSaved(false); return; }
    supabase
      .from("saved_landmarks")
      .select("id")
      .eq("user_id", user.id)
      .eq("landmark_id", landmark.id)
      .maybeSingle()
      .then(({ data }) => setSaved(!!data));
  }, [user, landmark?.id]);

  const toggleSave = async () => {
    if (!user) { setAuthOpen(true); return; }
    if (!landmark) return;
    if (saved) {
      await supabase.from("saved_landmarks").delete()
        .eq("user_id", user.id).eq("landmark_id", landmark.id);
      setSaved(false);
    } else {
      await supabase.from("saved_landmarks").upsert({
        user_id: user.id,
        landmark_id: landmark.id,
        landmark_data: landmark,
      });
      setSaved(true);
    }
  };

  // Lock background scroll on mobile when open
  useEffect(() => {
    if (!landmark) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [landmark]);

  if (!landmark) return null;
  const oh = landmark.openingHours;

  return (
    <>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        prompt="Sign in to save places to your collection."
      />
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm animate-in fade-in"
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-labelledby="lm-title"
        className={cn(
          "fixed z-50 flex flex-col bg-card text-card-foreground shadow-2xl",
          // Mobile: full-screen bottom sheet style
          "inset-x-0 bottom-0 top-0 animate-in slide-in-from-bottom",
          // Desktop: right side panel
          "md:inset-y-0 md:right-0 md:top-0 md:left-auto md:w-[min(560px,90vw)] md:slide-in-from-right md:rounded-none",
        )}
      >
        {/* Hero */}
        <div className="relative h-64 shrink-0 overflow-hidden md:h-72">
          {landmark.heroImage ? (
            <img
              src={landmark.heroImage}
              alt={landmark.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="h-full w-full"
              style={{ background: `linear-gradient(135deg, color-mix(in oklch, var(--cat-${landmark.category}) 30%, var(--card)) 0%, var(--muted) 100%)` }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 via-foreground/0 to-foreground/20" />

          <button
            type="button"
            onClick={onClose}
            className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-card/90 text-foreground backdrop-blur transition hover:bg-card"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setFavorite((v) => !v)}
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-card/90 backdrop-blur transition hover:bg-card"
            aria-label="Favorite"
          >
            <Heart
              className={cn("h-4 w-4 transition", favorite ? "fill-primary text-primary" : "text-foreground")}
            />
          </button>

          <div className="absolute bottom-4 left-4">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium backdrop-blur",
                oh.openNow
                  ? "bg-accent text-accent-foreground"
                  : "bg-card/90 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  oh.openNow ? "bg-accent-foreground" : "bg-muted-foreground",
                )}
              />
              {oh.openNow ? `Open now · until ${oh.close}` : `Closed · opens ${oh.open}`}
            </span>
          </div>
        </div>

        {/* Header */}
        <div className="border-b border-border px-5 pb-5 pt-5 md:px-7">
          {landmark.eyebrow && <p className="eyebrow">{landmark.eyebrow}</p>}
          <h2 id="lm-title" className="mt-2 font-serif text-3xl leading-tight md:text-4xl">
            {landmark.name}
          </h2>
          {landmark.nameCyrillic && (
            <p className="mt-1 font-serif text-base italic text-muted-foreground">
              {landmark.nameCyrillic}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {landmark.reviewCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Star className="h-4 w-4 fill-cat-landmark text-cat-landmark" />
                <span className="font-semibold">{landmark.rating.toFixed(1)}</span>
                <span className="text-muted-foreground">
                  ({landmark.reviewCount.toLocaleString()} reviews)
                </span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Footprints className="h-4 w-4" />
              {landmark.walkTimeMinutes} min walk
            </span>
            {(landmark.priceLabel || landmark.priceMKD > 0) && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Banknote className="h-4 w-4" />
                {landmark.priceLabel ?? formatPrice(landmark.priceMKD)}
              </span>
            )}
            <CategoryBadge category={landmark.category} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-border px-3 md:px-5">
          {(
            [
              { id: "reviews" as const, label: "Reviews" },
              { id: "practical" as const, label: "Practical" },
              { id: "ask" as const, label: "Ask AI" },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "relative px-4 py-3 text-sm font-medium transition-colors",
                tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={cn(
          "flex-1 min-h-0",
          tab === "ask"
            ? "flex flex-col overflow-hidden"
            : "overflow-y-auto px-5 py-5 md:px-7"
        )}>
          {tab === "reviews" && (
            <div className="space-y-5">
              {/* History / description — shown for non-food places as context */}
              {landmark.category !== "food" && landmark.category !== "cafe" && landmark.history && (
                <div className="space-y-2">
                  <p className="text-[15px] leading-relaxed text-foreground/85">{landmark.history}</p>
                  {landmark.wikipediaSummary && (
                    <p className="text-sm text-muted-foreground">
                      <span className="eyebrow mr-2 inline">Wikipedia</span>
                      {landmark.wikipediaSummary}
                    </p>
                  )}
                </div>
              )}

              {/* Live Google reviews */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Google reviews
                  </p>
                  {reviewsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>

                {reviewsLoading && liveReviews.length === 0 ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="rounded-2xl border border-border bg-background/60 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
                          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                        </div>
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                      </div>
                    ))}
                  </div>
                ) : liveReviews.length > 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {liveReviews.length} of {landmark.reviewCount.toLocaleString()} Google reviews
                    </p>
                    {liveReviews.map((r, i) => (
                      <div key={i} className="rounded-2xl border border-border bg-background/60 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{r.author}</span>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <StarRow rating={r.rating} />
                            <span>{r.relativeTime}</span>
                          </div>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-foreground/80">{r.text}</p>
                      </div>
                    ))}
                  </>
                ) : (
                  !reviewsLoading && (
                    <p className="text-sm text-muted-foreground">No reviews available for this place.</p>
                  )
                )}
              </div>
            </div>
          )}

          {tab === "practical" && (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoRow icon={Clock} label="Today" value={`${oh.open} – ${oh.close}`} />
                {(landmark.priceLabel || landmark.priceMKD > 0) && (
                  <InfoRow
                    icon={Banknote}
                    label="Price"
                    value={landmark.priceLabel ?? formatPrice(landmark.priceMKD)}
                  />
                )}
                <InfoRow icon={Footprints} label="From you" value={`~${landmark.walkTimeMinutes} min walk`} />
                {landmark.phone && (
                  <InfoRowLink icon={Phone} label="Phone" href={`tel:${landmark.phone}`} display={landmark.phone} />
                )}
                {landmark.website && (
                  <InfoRowLink icon={Globe} label="Website" href={landmark.website} display={new URL(landmark.website).hostname.replace("www.", "")} />
                )}
                <InfoRow
                  icon={MapPin}
                  label="Coordinates"
                  value={`${landmark.coordinates.lat.toFixed(4)}, ${landmark.coordinates.lng.toFixed(4)}`}
                />
              </dl>
              {landmark.weeklyHours && landmark.weeklyHours.length > 0 && (
                <div className="rounded-2xl border border-border bg-background/60 px-4 py-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Opening hours</p>
                  <ul className="space-y-1">
                    {landmark.weeklyHours.map((line, i) => (
                      <li key={i} className="text-sm text-foreground/80">{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {tab === "ask" && <AskAIChat landmark={landmark} />}
        </div>

        {/* Bottom action bar */}
        <div
          className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-5 py-4 md:px-7"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          <Button
            type="button"
            variant="outline"
            onClick={toggleSave}
            className="h-12 w-12 rounded-full p-0"
            aria-label={saved ? "Unsave" : "Save"}
          >
            <Bookmark className={cn("h-5 w-5", saved && "fill-primary text-primary")} />
          </Button>
        </div>
      </aside>
    </>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-medium">{value}</dd>
      </div>
    </div>
  );
}

function InfoRowLink({
  icon: Icon,
  label,
  href,
  display,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  display: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-2.5 transition hover:border-primary/40"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-medium text-primary">{display}</dd>
      </div>
    </a>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
        <Star
          key={n}
          className={cn(
            "h-3 w-3",
            n <= rating ? "fill-cat-landmark text-cat-landmark" : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

