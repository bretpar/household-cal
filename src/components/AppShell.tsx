import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { CalendarDays, Home, Sparkles, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import logoAsset from "@/assets/logo.png.asset.json";
import { LegalFooter } from "@/components/LegalFooter";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { reportShellMount, reportShellUnmount } from "@/lib/shell-remount-probe";
import { cn } from "@/lib/utils";

/** Content-only placeholder: the header and bottom nav stay visible around it. */
function PageContentSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden>
      <div className="h-8 w-2/3 rounded-2xl bg-secondary" />
      <div className="h-12 w-full rounded-2xl bg-secondary/70" />
      <div className="h-24 w-full rounded-3xl bg-secondary/60" />
      <div className="h-24 w-full rounded-3xl bg-secondary/50" />
    </div>
  );
}



const NAV = [
  { to: "/today", label: "Today", icon: Home },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/activities", label: "Activities", icon: Sparkles },
  { to: "/family", label: "Family", icon: Users },
] as const;

export function AppShell({
  children,
  /**
   * Mobile-only full-screen mode: the shell fills the viewport, the page body
   * never scrolls, and children get a flex column with the remaining height.
   * Desktop/tablet layout is unchanged.
   */
  fitViewport = false,
  compactMobileLandscape = false,
}: {
  children: ReactNode;
  fitViewport?: boolean;
  /** Compact chrome for the phone Calendar's landscape 3-Day view only. */
  compactMobileLandscape?: boolean;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Optimistic tab selection: the tap highlights instantly, before the
  // destination screen has mounted or loaded anything.
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => {
    setTapped(null);
  }, [pathname]);
  const activeTab = tapped ?? pathname;

  // Dev-only: warn if the shared header / bottom nav remount across a tab change.
  useEffect(() => {
    reportShellMount("header", pathname);
    reportShellMount("bottom-nav", pathname);
    return () => {
      reportShellUnmount("header", pathname);
      reportShellUnmount("bottom-nav", pathname);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Router transition between the four primary tabs: swap only the central
  // content for a light skeleton, never the shell.
  const isTransitioning = useRouterState({
    select: (s) => s.status === "pending" && s.location.pathname !== s.resolvedLocation?.pathname,
  });
  const tabPaths = NAV.map((n) => n.to) as readonly string[];
  const showContentSkeleton =
    isTransitioning && tabPaths.some((to) => activeTab.startsWith(to)) && !fitViewport;

  /** Warm the route (code + loader data) as soon as a finger/pointer lands. */
  const prefetch = (to: string) => {
    void router.preloadRoute({ to }).catch(() => {});
  };


  return (

    <div
      className={cn(
        "bg-background",
        compactMobileLandscape && "calendar-three-day-landscape",
        fitViewport
          ? "flex h-[100dvh] min-h-0 flex-col overflow-hidden md:h-auto md:min-h-screen md:overflow-visible"
          : "min-h-screen",
      )}
    >
      <header className="app-shell-header sticky top-0 z-30 shrink-0 border-b border-border-soft bg-surface/90 backdrop-blur">
        <div className="app-shell-header-inner mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 lg:px-8">

          <Link to="/today" className="flex min-w-0 items-center gap-2">
            <img
              src={logoAsset.url}
              alt="Our Family Calendar logo"
              className="h-9 w-9 shrink-0 rounded-xl object-contain sm:h-10 sm:w-10"
            />
            <span className="truncate font-display text-base font-bold sm:text-lg">
              Our Family Calendar
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <SyncStatusIndicator />
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  preload="intent"
                  onPointerDown={() => prefetch(to)}
                  className="flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary lg:px-4"
                  activeProps={{ className: "bg-secondary text-foreground" }}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="hidden lg:inline">{label}</span>
                </Link>
              ))}
            </nav>
          </div>

        </div>
      </header>

      <main
        className={cn(
          "app-shell-main mx-auto w-full max-w-6xl",
          fitViewport
            ? "flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:block md:min-h-0 md:flex-none md:overflow-visible md:px-4 md:pt-5 md:pb-12 lg:px-8"
            : "px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-12 lg:px-8",
        )}
      >
        {showContentSkeleton ? <PageContentSkeleton /> : children}
      </main>

      {fitViewport ? (
        <div className="hidden md:block">
          <LegalFooter />
        </div>
      ) : (
        // Padding clears the floating phone bottom nav and its safe-area gap.
        <div className="pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <LegalFooter />
        </div>
      )}


      {/* Phone bottom navigation */}
      <nav className="app-shell-bottom-nav fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-30 mx-auto max-w-lg rounded-3xl border border-border-soft bg-surface/95 p-1.5 shadow-lifted backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              preload="intent"
              onTouchStart={() => {
                setTapped(to);
                prefetch(to);
              }}
              onPointerDown={() => {
                setTapped(to);
                prefetch(to);
              }}
              className={cn(
                "app-shell-bottom-link",
                "relative flex h-16 min-h-16 w-full flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold text-muted-foreground",
                "transition-all duration-150 ease-out",
                "active:scale-95 active:bg-secondary/60 active:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                activeTab.startsWith(to) && "bg-accent text-primary",
              )}
            >
              <Icon className="h-7 w-7 transition-transform duration-150 ease-out" aria-hidden />
              <span className="leading-none">{label}</span>
            </Link>
          ))}
        </div>
      </nav>

    </div>
  );
}
