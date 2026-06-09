import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ExploreView } from "@/components/ExploreView";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "Explore — VisitMK" },
      { name: "description", content: "Discover landmarks, food and culture around you in North Macedonia." },
    ],
  }),
  component: () => (
    <AppShell>
      <ExploreView />
    </AppShell>
  ),
});
