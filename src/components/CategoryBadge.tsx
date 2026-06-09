import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

const labels: Record<Category, string> = {
  outdoors: "Outdoors",
  food: "Restaurant",
  cafe: "Café",
  shopping: "Shopping",
  culture: "Culture",
  landmark: "Landmark",
};

const tone: Record<Category, string> = {
  outdoors: "bg-cat-outdoors/10 text-cat-outdoors",
  food: "bg-cat-food/10 text-cat-food",
  cafe: "bg-cat-cafe/10 text-cat-cafe",
  shopping: "bg-cat-shopping/10 text-cat-shopping",
  culture: "bg-cat-culture/10 text-cat-culture",
  landmark: "bg-cat-landmark/15 text-cat-landmark",
};

export function CategoryBadge({ category, className }: { category: Category; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
        tone[category],
        className,
      )}
    >
      {labels[category]}
    </span>
  );
}

export const categoryLabels = labels;
export const categoryColorVar: Record<Category, string> = {
  outdoors: "var(--cat-outdoors)",
  food: "var(--cat-food)",
  cafe: "var(--cat-cafe)",
  shopping: "var(--cat-shopping)",
  culture: "var(--cat-culture)",
  landmark: "var(--cat-landmark)",
};
