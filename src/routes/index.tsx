import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { UnifiedView } from "@/components/UnifiedView";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VisitMK — Explore & Plan in Macedonia" },
      { name: "description", content: "AI-powered map & tour planner for Skopje, North Macedonia." },
      { property: "og:title", content: "VisitMK — Explore & Plan in Macedonia" },
      { property: "og:description", content: "AI-powered map & tour planner for Skopje." },
    ],
  }),
  component: () => (
    <AppShell>
      <UnifiedView />
    </AppShell>
  ),
});
