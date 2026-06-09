import { Link, useRouterState } from "@tanstack/react-router";
import { Compass, Map, Bookmark, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/", label: "Plan", icon: Map },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function AppNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <>
      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-4">
          {items.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <li key={to}>
                <Link
                  to={to}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-5 w-5", active && "stroke-[2.4]")} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center border-r border-border bg-card/80 py-5 md:flex lg:w-56 lg:items-stretch lg:px-4">
        <Link to="/" className="mb-8 flex items-center gap-2 lg:px-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground font-serif text-lg">
            V
          </span>
          <span className="hidden font-serif text-lg font-semibold lg:inline">VisitMK</span>
        </Link>
        <ul className="flex flex-col gap-1 lg:w-full">
          {items.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <li key={to}>
                <Link
                  to={to}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors lg:w-full",
                    "justify-center lg:justify-start",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="hidden lg:inline">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>
    </>
  );
}
