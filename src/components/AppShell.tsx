import { type ReactNode } from "react";
import { AppNav } from "./AppNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="pb-20 md:pb-0 md:pl-20 lg:pl-56">{children}</main>
    </div>
  );
}
