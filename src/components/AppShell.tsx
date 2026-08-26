import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Home, LogOut, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";

import logoAsset from "@/assets/logo.png.asset.json";
import { LegalFooter } from "@/components/LegalFooter";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { supabase } from "@/integrations/supabase/client";
import { useCalendar } from "@/lib/calendar-store";

const NAV = [
  { to: "/today", label: "Today", icon: Home },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/activities", label: "Activities", icon: Sparkles },
  { to: "/family", label: "Family", icon: Users },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { family } = useCalendar();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const householdName = family?.name ?? "Family";
  const initial = householdName.trim().charAt(0).toUpperCase() || "F";

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border-soft bg-surface/90 backdrop-blur">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 lg:px-8">
          <Link to="/today" className="flex min-w-0 items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">
              {initial}
            </span>
            <span className="truncate font-display text-lg font-bold">{householdName}</span>
          </Link>
          <div className="flex items-center gap-1">
            <SyncStatusIndicator />
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary"
                  activeProps={{ className: "bg-secondary text-foreground" }}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
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
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 pb-28 md:pb-12 lg:px-8">
        {children}
        <LegalFooter />
      </main>

      {/* Phone bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border-soft bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-4">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground"
              activeProps={{ className: "text-primary" }}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
