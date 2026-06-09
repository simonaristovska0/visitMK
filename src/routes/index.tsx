import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PlanView } from "@/components/PlanView";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VisitMK — Plan your day in Macedonia" },
      { name: "description", content: "Chat-first itinerary planner for North Macedonia. Tell us your wish, get a route." },
      { property: "og:title", content: "VisitMK — Plan your day in Macedonia" },
      { property: "og:description", content: "Chat-first itinerary planner for North Macedonia." },
    ],
  }),
  component: () => (
    <AppShell>
      <PlanView />
    </AppShell>
  ),
});
