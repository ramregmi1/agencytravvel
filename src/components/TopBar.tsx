// Himalayan Modernism style rules for this file:
// - Minimal, semantic top navigation
// - Strong hierarchy, clean markup, easy to extend
// - Mobile-first: hamburger menu via Sheet

import { Menu, MountainSnow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavItem = { label: string; href: string };

export default function TopBar({
  title = "Nepal Route Planner",
  tagline = "Routes • time • cost • hotels",
  nav,
}: {
  title?: string;
  tagline?: string;
  nav: NavItem[];
}) {
  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-mountain">
          <MountainSnow className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-lg text-white">{title}</div>
          <div className="text-xs text-white/70">{tagline}</div>
        </div>
      </div>

      {/* Desktop nav */}
      <nav className="hidden items-center gap-2 md:flex" aria-label="Primary">
        {nav.map((item) => (
          <a
            key={item.href}
            className="rounded-xl px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            href={item.href}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {/* Mobile hamburger */}
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              size="icon"
              variant="secondary"
              className="rounded-2xl bg-white/10 text-white hover:bg-white/20"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[320px]">
            <SheetHeader>
              <SheetTitle className="font-display">{title}</SheetTitle>
            </SheetHeader>

            <div className="mt-6 grid gap-2">
              {nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary"
                >
                  {item.label}
                </a>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-secondary p-4 text-xs text-muted-foreground">
              Tip: Use the planner to get route, time, and hotels.
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
