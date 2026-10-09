import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getVerifiedMembership } from "@/lib/auth-guard";
import { useCalendar } from "@/lib/calendar-store";
import { hasFeature } from "@/lib/features";
import { useCaregiver } from "@/lib/use-caregiver";
import { shouldAutoStartTour, tourSteps, tourStorageKey, type TourStatus } from "@/lib/app-tour";

const TourContext = createContext<(() => void) | null>(null);

function visibleTarget(id: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-tour-target]")).find((el) =>
    el.dataset["tourTarget"] === id && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
  );
}

export function AppTourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { family, isOwner } = useCalendar();
  const { resolved, failed, isCaregiver } = useCaregiver();
  const [userId, setUserId] = useState<string | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; width: number; height: number; x: number; y: number; below: boolean } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const focusBefore = useRef<HTMLElement | null>(null);
  const autoChecked = useRef<string | null>(null);
  const steps = useMemo(() => tourSteps(isCaregiver, isOwner, hasFeature("timesheets", { familyId: family?.id })), [isCaregiver, isOwner, family?.id]);
  const step = index === null ? undefined : steps[index];
  const accessReady = resolved && !failed && !!family;

  const start = useCallback(() => {
    if (!accessReady || !userId) return;
    focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPlacement(null);
    setIndex(0);
  }, [accessReady, userId]);

  const finish = useCallback((status: TourStatus) => {
    if (userId) {
      try { localStorage.setItem(tourStorageKey(userId), JSON.stringify({ status, at: new Date().toISOString() })); } catch { /* optional device preference */ }
    }
    setIndex(null);
    setPlacement(null);
    focusBefore.current?.focus();
  }, [userId]);

  useEffect(() => {
    if (!accessReady) { setIndex(null); setPlacement(null); return; }
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      // Identity must match the verified guard, never just a cached session.
      if (cancelled || !user || getVerifiedMembership()?.userId !== user.id) return;
      setUserId(user.id);
      if (autoChecked.current === user.id) return;
      autoChecked.current = user.id;
      try {
        if (shouldAutoStartTour(user.created_at, localStorage.getItem(tourStorageKey(user.id)))) {
          focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setIndex(0);
        }
      } catch { /* No reliable persistence: manual replay remains available. */ }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [accessReady, family?.id]);

  useEffect(() => {
    if (!step || !accessReady) return;
    setPlacement(null);
    let cancelled = false;
    let openedFilter: HTMLElement | undefined;
    const began = Date.now();
    let frame = 0;
    if (step.id === "people") void navigate({ to: "/today" }).catch(() => {});
    const measure = () => {
      if (cancelled) return;
      // Wait for the existing heart reveal and any page transition, not events.
      if (document.querySelector(".startup-splash-bg")) {
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
      const r = target.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) target.scrollIntoView({ block: "center", behavior: "instant" });
      const pad = 4;
      const left = Math.max(4, r.left - pad);
      const top = Math.max(4, r.top - pad);
      const width = Math.min(window.innerWidth - left - 4, r.width + pad * 2);
      const height = Math.min(window.innerHeight - top - 4, r.height + pad * 2);
      const cardWidth = Math.min(320, window.innerWidth - 24);
      const cardHeight = cardRef.current?.offsetHeight ?? 220;
      const below = window.innerHeight - (top + height) >= cardHeight + 24;
      const x = Math.max(12, Math.min(left + width / 2 - cardWidth / 2, window.innerWidth - cardWidth - 12));
      const y = below ? top + height + 12 : Math.max(12, top - cardHeight - 12);
      const next = { left, top, width, height, x, y, below };
      setPlacement((old) => old && Object.keys(next).every((key) => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (openedFilter?.getAttribute("aria-expanded") === "true") openedFilter.click();
    };
  }, [step, accessReady, index, steps.length, finish, navigate]);

  useEffect(() => {
    if (!placement || index === null) return;
    cardRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); finish("dismissed"); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [index, !!placement, finish]);

  return <TourContext.Provider value={start}>
    {children}
    {step && placement && accessReady && createPortal(
      <div className="app-tour-layer fixed inset-0 z-[80] pointer-events-none">
        <div className="app-tour-dimmer" style={{ left: 0, top: 0, width: "100%", height: placement.top }} />
        <div className="app-tour-dimmer" style={{ left: 0, top: placement.top, width: placement.left, height: placement.height }} />
        <div className="app-tour-dimmer" style={{ left: placement.left + placement.width, top: placement.top, right: 0, height: placement.height }} />
        <div className="app-tour-dimmer" style={{ left: 0, top: placement.top + placement.height, bottom: 0, width: "100%" }} />
        <div className="absolute rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background" style={{ left: placement.left, top: placement.top, width: placement.width, height: placement.height }} />
        <div ref={cardRef} role="dialog" aria-labelledby="app-tour-title" aria-describedby="app-tour-description" tabIndex={-1} className="app-tour-tooltip pointer-events-auto absolute w-80 max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lifted outline-none" style={{ left: placement.x, top: placement.y, maxHeight: placement.below ? `calc(100dvh - ${placement.y + 12}px)` : Math.max(100, placement.top - 24), overflowY: "auto" }}>
          <span aria-hidden className={`absolute h-3 w-3 rotate-45 border-border bg-popover ${placement.below ? "-top-1.5 border-t border-l" : "-bottom-1.5 border-r border-b"}`} style={{ left: Math.max(16, Math.min(placement.width / 2 + placement.left - placement.x, Math.min(320, window.innerWidth - 24) - 24)) }} />
          <p className="text-xs font-semibold text-muted-foreground" aria-live="polite">{(index ?? 0) + 1} / {steps.length}</p>
          <h2 id="app-tour-title" className="mt-1 text-lg font-bold">{step.title}</h2>
          <p id="app-tour-description" className="mt-2 text-sm leading-relaxed">{step.description}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => finish("dismissed")}>Skip</Button>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, (value ?? 0) - 1))}><ArrowLeft />Back</Button>
              <Button size="sm" onClick={() => index === steps.length - 1 ? finish("completed") : setIndex((value) => (value ?? 0) + 1)}>{index === steps.length - 1 ? <>Done<Check /></> : <>Next<ArrowRight /></>}</Button>
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