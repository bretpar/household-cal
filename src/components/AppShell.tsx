import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, ClipboardList, Home, Settings, Sparkles, Users } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import logoAsset from "@/assets/logo.png.asset.json";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { reportShellMount, reportShellUnmount } from "@/lib/shell-remount-probe";
import { cn } from "@/lib/utils";
import { useCaregiver } from "@/lib/use-caregiver";
import { useMyTimesheetActionCount, usePendingTimesheetCount } from "@/components/TimesheetSettings";
import { useCalendar } from "@/lib/calendar-store";
import { hasFeature } from "@/lib/features";
import { useTimesheetsStatus } from "@/lib/use-timesheets-status";

/** Content-only placeholder: the header and bottom nav stay visible around it. */
export function PageContentSkeleton() {
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

const CAREGIVER_NAV = [
  { to: "/today", label: "Today", icon: Home },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/timesheet", label: "Timesheet", icon: ClipboardList },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

type ShellOptions = { fitViewport: boolean; compactMobileLandscape: boolean; lockChrome: boolean };
type ShellRegistry = { register: (id: object, o: ShellOptions) => void; unregister: (id: object) => void };
const ShellContext = createContext<ShellRegistry | null>(null);

/**
 * Page-level shell declaration. Inside the authenticated layout it only
 * registers this page's shell options with the one persistent frame, so the
 * header and bottom nav never remount across tab changes.
 */
export function AppShell({
  children,
  /**
   * Mobile-only full-screen mode: the shell fills the viewport, the page body
   * never scrolls, and children get a flex column with the remaining height.
   * Desktop/tablet layout is unchanged.
   */
  fitViewport = false,
  compactMobileLandscape = false,
  lockChrome = false,
}: {
  children: ReactNode;
  fitViewport?: boolean;
  /** Compact chrome for the phone Calendar in landscape. */
  compactMobileLandscape?: boolean;
  /**
   * Access-error pages: keep the header/tabs from the last verified role and
   * never swap the content for permission skeletons. With no verified role
   * yet, a minimal neutral shell (no tabs) is shown instead of privileged
   * links.
   */
  lockChrome?: boolean;
}) {
  const registry = useContext(ShellContext);
  const id = useRef({}).current;
  useLayoutEffect(() => {
    registry?.register(id, { fitViewport, compactMobileLandscape, lockChrome });
  }, [registry, id, fitViewport, compactMobileLandscape, lockChrome]);
  useLayoutEffect(() => () => registry?.unregister(id), [registry, id]);
  if (!registry) {
    return (
      <ShellFrame active fitViewport={fitViewport} compactMobileLandscape={compactMobileLandscape} lockChrome={lockChrome}>
        {children}
      </ShellFrame>
    );
  }
  return <>{children}</>;
}

/**
 * The single persistent shell for authenticated routes. Chrome shows only
 * while a page has declared an AppShell (onboarding has none); the content
 * slot keeps a stable position so route content never remounts on toggle.
 */
export function PersistentAppShell({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<object, ShellOptions>());
  const [opts, setOpts] = useState<ShellOptions | null>(null);
  const [registry] = useState<ShellRegistry>(() => {
    const sync = () => {
      const all = [...entries.current.values()];
      const last = all[all.length - 1] ?? null;
      setOpts((prev) =>
        prev && last && prev.fitViewport === last.fitViewport && prev.compactMobileLandscape === last.compactMobileLandscape && prev.lockChrome === last.lockChrome
          ? prev
          : last,
      );
    };
    return {
      register: (id, o) => { entries.current.set(id, o); sync(); },
      unregister: (id) => { entries.current.delete(id); sync(); },
    };
  });
  return (
    <ShellContext.Provider value={registry}>
      <ShellFrame
        active={!!opts}
        fitViewport={opts?.fitViewport ?? false}
        compactMobileLandscape={opts?.compactMobileLandscape ?? false}
        lockChrome={opts?.lockChrome ?? false}
      >
        {children}
      </ShellFrame>
    </ShellContext.Provider>
  );
}

function ShellFrame({
  children,
  active,
  fitViewport,
  compactMobileLandscape,
  lockChrome,
}: {
  children: ReactNode;
  active: boolean;
  fitViewport: boolean;
  compactMobileLandscape: boolean;
  lockChrome: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isCaregiver, resolved: caregiverResolved, failed: accessFailed, retry: retryAccess } = useCaregiver();
  const { isOwner, family } = useCalendar();
  const ts = useTimesheetsStatus();
  // Caregivers keep a read-only tab while past time cards exist.
  const timesheetsOn = hasFeature("timesheets", { familyId: family?.id }) && (ts.active || ts.history);
  const timesheetsActive = timesheetsOn && ts.active;
  // Last verified, identity-scoped role answer. On access-error pages
  // (lockChrome) it keeps the correct tabs visible while a retry re-verifies;
  // with no verified answer yet, the shell stays neutral (no tabs).
  const lastVerified = useRef<{ isCaregiver: boolean; timesheetsOn: boolean } | null>(null);
  useEffect(() => {
    if (caregiverResolved) lastVerified.current = { isCaregiver, timesheetsOn };
  }, [caregiverResolved, isCaregiver, timesheetsOn]);
  const chromeResolved = caregiverResolved || (lockChrome && lastVerified.current !== null);
  const chromeCaregiver = caregiverResolved ? isCaregiver : (lastVerified.current?.isCaregiver ?? false);
  const chromeTimesheetsOn = caregiverResolved ? timesheetsOn : (lastVerified.current?.timesheetsOn ?? false);
  // No tabs until caregiver status is known, so a caregiver never sees parent tabs.
  const nav = !chromeResolved
    ? []
    : chromeCaregiver
      ? CAREGIVER_NAV.filter((n) => n.to !== "/timesheet" || chromeTimesheetsOn)
      : NAV;
  const ownerPending = usePendingTimesheetCount(!isCaregiver && isOwner && timesheetsActive);
  const myActions = useMyTimesheetActionCount(isCaregiver && timesheetsActive);
  const badgeTo = isCaregiver ? "/timesheet" : "/activities";
  const pendingReview = isCaregiver ? myActions : ownerPending;
  const badgeFor = (to: string) =>
    to === badgeTo && pendingReview > 0 ? (
      <span
        className="absolute top-1 right-[calc(50%-1.5rem)] min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-bold text-destructive-foreground"
        aria-label={`${pendingReview} timesheet${pendingReview === 1 ? "" : "s"} ${isCaregiver ? "need your attention" : "to review"}`}
      >
        {pendingReview}
      </span>
    ) : null;
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
  const tabPaths = nav.map((n) => n.to) as readonly string[];
  const showContentSkeleton =
    isTransitioning && tabPaths.some((to) => activeTab.startsWith(to)) && !fitViewport;



  return (

    <div
      className={cn(
        !active && "contents",
        active && "bg-background",
        compactMobileLandscape && "calendar-three-day-landscape",
        !active ? null : fitViewport
          ? "flex h-[100dvh] min-h-0 flex-col overflow-hidden md:h-auto md:min-h-screen md:overflow-visible"
          : "min-h-screen",
      )}
    >
      {active && <header className="app-shell-header sticky top-0 z-30 shrink-0 border-b border-border-soft bg-surface/90 backdrop-blur">
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
              {nav.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  data-tour-target={to}
                  preload="intent"
                  className="flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary lg:px-4"
                  activeProps={{ className: "bg-secondary text-foreground" }}
                >
                  <span className="relative"><Icon className="h-4 w-4" aria-hidden />{pendingReview > 0 && to === badgeTo ? <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-bold text-destructive-foreground">{pendingReview}</span> : null}</span>
                  <span className="hidden lg:inline">{label}</span>
                </Link>
              ))}
            </nav>
          </div>

        </div>
      </header>}

      <main
        className={cn(
          !active ? "contents" : "app-shell-main mx-auto w-full max-w-6xl",
          !active ? null : fitViewport
            ? "flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:block md:min-h-0 md:flex-none md:overflow-visible md:px-4 md:pt-5 md:pb-12 lg:px-8"
            : "px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-12 lg:px-8",
        )}
      >
        {active && !lockChrome && accessFailed && !caregiverResolved ? (
          <div className="mx-auto max-w-sm space-y-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">We couldn't confirm your access.</p>
            <button
              type="button"
              onClick={retryAccess}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Try again
            </button>
          </div>
        ) : active && !lockChrome && (!caregiverResolved || showContentSkeleton) ? (
          <PageContentSkeleton />
        ) : null}
        {/* Route content stays mounted (it declares the shell); it is only
            hidden while access or a tab transition is pending. Locked-chrome
            (access-error) pages always render their own content. */}
        <div
          className={
            active && !lockChrome && (!caregiverResolved || showContentSkeleton) ? "hidden" : "contents"
          }
        >
          {children}
        </div>
      </main>



      {/* Phone bottom navigation */}
      {active && <nav className="app-shell-bottom-nav fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-30 mx-auto max-w-lg rounded-3xl border border-border-soft bg-surface/95 p-1.5 shadow-lifted backdrop-blur md:hidden">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
          {nav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              data-tour-target={to}
              preload="intent"
              // preload="intent" already warms the route on touch/hover; only
              // highlight the tab here so we don't fire duplicate preloads.
              onPointerDown={() => setTapped(to)}
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
              {badgeFor(to)}
            </Link>
          ))}
        </div>
      </nav>}

    </div>
  );
}
