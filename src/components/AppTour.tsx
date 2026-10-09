import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getVerifiedMembership } from "@/lib/auth-guard";
import { useCalendar } from "@/lib/calendar-store";
import { hasFeature } from "@/lib/features";
import { useCaregiver } from "@/lib/use-caregiver";
import { TOUR_VERSION, shouldAutoStartTour, tourSteps, tourStorageKey, type TourStatus } from "@/lib/app-tour";

const TourContext = createContext<(() => void) | null>(null);
type Placement = { left: number; top: number; width: number; height: number; x: number; y: number; below: boolean; radius: number };

// Each step's own page. Ids come only from the role-filtered tourSteps list,
// so caregivers are never sent to a page outside their tour.
const STEP_ROUTES = {
  "/today": "/today", people: "/today", "/calendar": "/calendar", "/activities": "/activities",
  "/timesheet": "/timesheet", "/settings": "/settings", "/family": "/family",
} as const;
type StepRoute = (typeof STEP_ROUTES)[keyof typeof STEP_ROUTES];
const stepRoute = (id: string) => (STEP_ROUTES as Record<string, StepRoute | undefined>)[id];

function visibleTarget(id: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-tour-target]")).find((el) =>
    el.dataset["tourTarget"] === id && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
  );
}

export function AppTourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const router = useRouter();
  const origin = useRef<string | null>(null);
  const { family, isOwner } = useCalendar();
  const { resolved, failed, isCaregiver } = useCaregiver();
  const [userId, setUserId] = useState<string | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // The step the card currently shows; it only catches up with `index` once
  // the destination page and its spotlight target are mounted and settled.
  const [shownIndex, setShownIndex] = useState<number | null>(null);
  const placementRef = useRef<Placement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const focusBefore = useRef<HTMLElement | null>(null);
  const autoChecked = useRef<string | null>(null);
  const steps = useMemo(() => {
    const ordered = tourSteps(isCaregiver, isOwner, hasFeature("timesheets", { familyId: family?.id }));
    // Swap the parent tour's Calendar and Family initials steps only; caregiver
    // steps have different content and retain their existing permission flow.
    if (!isCaregiver) {
      const second = ordered[1];
      const third = ordered[2];
      if (second && third) { ordered[1] = third; ordered[2] = second; }
    }
    return ordered;
  }, [isCaregiver, isOwner, family?.id]);
  const step = index === null ? undefined : steps[index];
  const accessReady = resolved && !failed && !!family;

  const start = useCallback(() => {
    if (!accessReady || !userId || getVerifiedMembership()?.userId !== userId) return;
    focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    origin.current = window.location.pathname + window.location.search;
    placementRef.current = null;
    setPlacement(null);
    setIndex(0);
  }, [accessReady, userId]);

  const finish = useCallback((status: TourStatus) => {
    if (userId) {
      try { localStorage.setItem(tourStorageKey(userId), JSON.stringify({ status, at: new Date().toISOString() })); } catch { /* local cache only */ }
      void supabase.from("app_tour_states").upsert(
        { user_id: userId, tour_version: TOUR_VERSION, status, updated_at: new Date().toISOString() },
        { onConflict: "user_id,tour_version" },
      ).then(() => {}, () => {});
    }
    setIndex(null);
    setShownIndex(null);
    placementRef.current = null;
    setPlacement(null);
    const back = origin.current;
    origin.current = null;
    if (back && back !== window.location.pathname + window.location.search) router.history.push(back);
    focusBefore.current?.focus();
  }, [userId, router]);

  useEffect(() => {
    if (!accessReady) { setIndex(null); placementRef.current = null; setPlacement(null); return; }
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      // Identity must match the verified guard, never just a cached session.
      if (cancelled || !user || getVerifiedMembership()?.userId !== user.id) return;
      setUserId(user.id);
      if (autoChecked.current === user.id) return;
      autoChecked.current = user.id;
      let local: string | null = null;
      try { local = localStorage.getItem(tourStorageKey(user.id)); } catch { /* ignore */ }
      if (!shouldAutoStartTour(user.created_at, local)) return;
      // Cross-device state: only auto-start once the backend confirms no saved row.
      void supabase.from("app_tour_states").select("status")
        .eq("user_id", user.id).eq("tour_version", TOUR_VERSION).maybeSingle()
        .then(({ data: row, error }) => {
          if (cancelled || error || getVerifiedMembership()?.userId !== user.id) return;
          if (row) {
            try { localStorage.setItem(tourStorageKey(user.id), JSON.stringify({ status: row.status })); } catch { /* ignore */ }
            return;
          }
          focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          origin.current = window.location.pathname + window.location.search;
          setIndex(0);
        }, () => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [accessReady, family?.id]);

  useEffect(() => {
    if (!step || !accessReady) return;
    // Keep the portal and its last rounded cutout mounted while locating the
    // next target. Clearing placement here exposed the undimmed page each step.
    let cancelled = false;
    const previous = placementRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let transitionStarted: number | undefined;
    let openedFilter: HTMLElement | undefined;
    const began = Date.now();
    let frame = 0;
    const dest = stepRoute(step.id);
    const needsNav = !!dest && window.location.pathname !== dest;
    if (dest && needsNav) void navigate({ to: dest }).catch(() => {});
    let lastRect = "";
    let stableFrames = 0;
    const measure = () => {
      if (cancelled) return;
      if (getVerifiedMembership()?.userId !== userId) {
        setIndex(null);
        placementRef.current = null;
        setPlacement(null);
        return;
      }
      // Wait for the existing heart reveal and any page transition, not events.
      if (document.querySelector(".startup-splash-bg")) {
        frame = requestAnimationFrame(measure);
        return;
      }
      // Keep the previous dimmed cutout until the destination page has
      // rendered and settled, so the highlight never jumps mid-layout.
      if (dest && window.location.pathname !== dest && Date.now() - began < 3000) {
        frame = requestAnimationFrame(measure);
        return;
      }
      if (step.id === "people" && !visibleTarget("people")) {
        const trigger = visibleTarget("people-filter");
        if (trigger && trigger.getAttribute("aria-expanded") !== "true") {
          trigger.click();
          openedFilter = trigger;
        }
      }
      const target = visibleTarget(step.id);
      if (!target) {
        if (Date.now() - began > 3000) {
          if (index !== null && index < steps.length - 1) setIndex(index + 1);
          else finish("completed");
          return;
        }
        frame = requestAnimationFrame(measure);
        return;
      }
      let r = target.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) {
        target.scrollIntoView({ block: "center", behavior: "instant" });
        r = target.getBoundingClientRect();
      }
      // Page-ready gate: the target must have real, unchanged coordinates for a
      // few consecutive frames (route mounted, layout settled) before the card
      // and spotlight advance together. Bounded by the 3s fallback.
      if (transitionStarted === undefined) {
        const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
        const valid = r.width > 0 && r.height > 0;
        stableFrames = valid && key === lastRect ? stableFrames + 1 : 0;
        lastRect = key;
        if (stableFrames < (needsNav ? 3 : 1) && Date.now() - began < 3000) {
          frame = requestAnimationFrame(measure);
          return;
        }
        setShownIndex(index);
      }
      const pad = 4;
      // Match the spotlight's corner radius to the target (e.g. rounded bottom
      // nav items) so the highlight never shows square corners.
      const targetRadius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
      const radius = targetRadius > 0 ? Math.min(targetRadius + pad, 24) : 8;
      const left = Math.max(4, r.left - pad);
      const top = Math.max(4, r.top - pad);
      const width = Math.min(window.innerWidth - left - 4, r.width + pad * 2);
      const height = Math.min(window.innerHeight - top - 4, r.height + pad * 2);
      const cardWidth = Math.min(320, window.innerWidth - 24);
      const cardHeight = cardRef.current?.offsetHeight ?? 220;
      const below = window.innerHeight - (top + height) >= cardHeight + 24;
      const x = Math.max(12, Math.min(left + width / 2 - cardWidth / 2, window.innerWidth - cardWidth - 12));
      const y = below ? top + height + 12 : Math.max(12, top - cardHeight - 12);
      const next = { left, top, width, height, x, y, below, radius };
      const now = performance.now();
      transitionStarted ??= now;
      const progress = previous && !reducedMotion ? Math.min(1, (now - transitionStarted) / 160) : 1;
      const eased = 1 - (1 - progress) ** 3;
      const displayed: Placement = { ...next };
      if (previous && progress < 1) {
        for (const key of ["left", "top", "width", "height", "x", "y", "radius"] as const) {
          displayed[key] = previous[key] + (next[key] - previous[key]) * eased;
        }
      }
      // One shared animated geometry drives the SVG cutout, outline and card,
      // so their boundaries cannot diverge during the short movement.
      placementRef.current = displayed;
      setPlacement((old) => old && Object.keys(displayed).every((key) => old[key as keyof Placement] === displayed[key as keyof Placement]) ? old : displayed);
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (openedFilter?.getAttribute("aria-expanded") === "true") openedFilter.click();
    };
  }, [step, accessReady, index, steps.length, finish, navigate, userId]);

  useEffect(() => {
    if (!placement || index === null) return;
    cardRef.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); finish("dismissed"); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [index, !!placement, finish]);

  // The dimmer and blue outline share one rounded boundary, including corners.
  const pending = index !== shownIndex;
  const shownStep = (shownIndex === null ? undefined : steps[shownIndex]) ?? step;
  const spotlightRadius = placement ? Math.min(placement.radius, placement.width / 2, placement.height / 2) : 0;

  return <TourContext.Provider value={start}>
    {children}
    {step && placement && accessReady && createPortal(
      <div className="app-tour-layer fixed inset-0 z-[80] pointer-events-none">
        <svg aria-hidden className="absolute inset-0 h-full w-full">
          <path
            className="app-tour-dimmer"
            fillRule="evenodd"
            d={`M0 0H${window.innerWidth}V${window.innerHeight}H0Z
              M${placement.left + spotlightRadius} ${placement.top}
              h${placement.width - 2 * spotlightRadius}
              a${spotlightRadius} ${spotlightRadius} 0 0 1 ${spotlightRadius} ${spotlightRadius}
              v${placement.height - 2 * spotlightRadius}
              a${spotlightRadius} ${spotlightRadius} 0 0 1 ${-spotlightRadius} ${spotlightRadius}
              h${-placement.width + 2 * spotlightRadius}
              a${spotlightRadius} ${spotlightRadius} 0 0 1 ${-spotlightRadius} ${-spotlightRadius}
              v${-placement.height + 2 * spotlightRadius}
              a${spotlightRadius} ${spotlightRadius} 0 0 1 ${spotlightRadius} ${-spotlightRadius}Z`}
          />
        </svg>
        <div className="absolute ring-2 ring-primary" style={{ left: placement.left, top: placement.top, width: placement.width, height: placement.height, borderRadius: spotlightRadius }} />
        <div ref={cardRef} role="dialog" aria-labelledby="app-tour-title" aria-describedby="app-tour-description" tabIndex={-1} className="app-tour-tooltip pointer-events-auto absolute w-80 max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lifted outline-none" style={{ left: placement.x, top: placement.y, maxHeight: placement.below ? `calc(100dvh - ${placement.y + 12}px)` : Math.max(100, placement.top - 24), overflowY: "auto" }}>
          <span aria-hidden className={`absolute h-3 w-3 rotate-45 border-border bg-popover ${placement.below ? "top-0 border-t border-l" : "bottom-0 border-r border-b"}`} style={{ left: Math.max(16, Math.min(placement.width / 2 + placement.left - placement.x, Math.min(320, window.innerWidth - 24) - 24)) }} />
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="app-tour-title" className="text-lg font-bold">{shownStep?.title}</h2>
            <p className="shrink-0 text-xs font-semibold text-muted-foreground" aria-live="polite">{(shownIndex ?? index ?? 0) + 1} / {steps.length}</p>
          </div>
          <p id="app-tour-description" className="mt-1 text-sm leading-relaxed">{shownStep?.description}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => finish("dismissed")}>Skip</Button>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" disabled={pending || shownIndex === 0} onClick={() => setIndex((value) => Math.max(0, (value ?? 0) - 1))}><ArrowLeft />Back</Button>
              <Button size="sm" disabled={pending} aria-busy={pending} onClick={() => index === steps.length - 1 ? finish("completed") : setIndex((value) => (value ?? 0) + 1)}>{pending ? <><Loader2 className="animate-spin motion-reduce:animate-none" />Next</> : index === steps.length - 1 ? <>Done<Check /></> : <>Next<ArrowRight /></>}</Button>
            </div>
          </div>
        </div>
      </div>, document.body,
    )}
  </TourContext.Provider>;
}

export function ReplayAppTour() {
  const replay = useContext(TourContext);
  return <Button variant="outline" className="w-full justify-start" disabled={!replay} onClick={() => replay?.()}><RotateCcw />Replay app tour</Button>;
}