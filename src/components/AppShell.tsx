import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Home, LogOut, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";

import logoAsset from "@/assets/logo.png.asset.json";
import { LegalFooter } from "@/components/LegalFooter";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";


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
}: {
  children: ReactNode;
  fitViewport?: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div
      className={cn(
        "bg-background",
        fitViewport
          ? "flex h-[100dvh] min-h-0 flex-col overflow-hidden md:h-auto md:min-h-screen md:overflow-visible"
          : "min-h-screen",
      )}
    >
      <header className="sticky top-0 z-30 shrink-0 border-b border-border-soft bg-surface/90 backdrop-blur">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 lg:px-8">

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
                  className="flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary lg:px-4"
                  activeProps={{ className: "bg-secondary text-foreground" }}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="hidden lg:inline">{label}</span>
                </Link>
              ))}
            </nav>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden lg:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-6xl",
          fitViewport
            ? "flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:block md:min-h-0 md:flex-none md:overflow-visible md:px-4 md:pt-5 md:pb-12 lg:px-8"
            : "px-4 pt-5 pb-28 md:pb-12 lg:px-8",
        )}
      >
        {children}
        {fitViewport ? (
          <div className="hidden md:block">
            <LegalFooter />
          </div>
        ) : (
          <LegalFooter />
        )}
      </main>


      {/* Phone bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border-soft bg-surface/95 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <div className="grid h-[calc(3.75rem+max(8px,env(safe-area-inset-bottom)))] min-h-[3.75rem] grid-cols-4 items-stretch">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground active:bg-secondary/50"
              activeProps={{ className: "text-primary" }}
            >
              <Icon className="h-6 w-6" aria-hidden />
              <span className="leading-none">{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
