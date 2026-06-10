import type { Landmark } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PlacesResultCardProps {
  content: string;
  landmarks: Landmark[];
  groupColor: string;
  onLandmarkClick?: (id: string) => void;
}

export function PlacesResultCard({ content, landmarks, groupColor, onLandmarkClick }: PlacesResultCardProps) {
  const preview = landmarks.slice(0, 4);
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Thumbnail grid */}
      {preview.length > 0 && (
        <div
          className={cn(
            "grid gap-0.5 bg-muted",
            preview.length === 1 ? "grid-cols-1" : preview.length === 2 ? "grid-cols-2" : "grid-cols-2",
          )}
          style={{ maxHeight: 128 }}
        >
          {preview.map((lm, i) => (
            <button
              key={lm.id}
              type="button"
              onClick={() => onLandmarkClick?.(lm.id)}
              className={cn(
                "relative overflow-hidden",
                preview.length === 3 && i === 2 ? "col-span-2" : "",
              )}
              style={{ height: preview.length <= 2 ? 128 : 64 }}
            >
              {lm.heroImage ? (
                <img src={lm.heroImage} alt={lm.name} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" style={{ background: `${groupColor}22` }} />
              )}
              <div className="absolute inset-0 bg-black/30" />
              <span className="absolute bottom-1 left-1.5 text-[10px] font-medium text-white/90 leading-tight line-clamp-1">
                {lm.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Summary row */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: groupColor }}
        />
        <p className="text-sm text-foreground leading-snug">{content}</p>
      </div>

      {/* Count badge */}
      {landmarks.length > 4 && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          +{landmarks.length - 4} more — tap a pin to explore
        </p>
      )}
    </div>
  );
}
