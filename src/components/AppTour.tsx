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
import { TOUR_VERSION, shouldAutoStartTour, tourSteps, tourStorageKey, type TourStatus } from "@/lib/app-tour";

const TourContext = createContext<(() => void) | null>(null);
export function AppTourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { family, isOwner } = useCalendar();
  const { resolved, failed, isCaregiver } = useCaregiver();
  const [userId, setUserId] = useState<string | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const autoChecked = useRef<string | null>(null);
  const steps = useMemo(() => {
    return tourSteps(isCaregiver, isOwner, hasFeature("timesheets", { familyId: family?.id }));
  }, [isCaregiver, isOwner, family?.id]);
  const step = index === null ? undefined : steps[index];
  const accessReady = resolved && !failed && !!family;

  const start = useCallback(() => {
    if (!accessReady || !userId || getVerifiedMembership()?.userId !== userId) return;
    // Replay enters Today once; changing tips never changes the page.
    void navigate({ to: "/today" }).then(() => setIndex(0)).catch(() => {});
  }, [accessReady, userId, navigate]);

  const finish = useCallback((status: TourStatus) => {
    if (userId) {
      try { localStorage.setItem(tourStorageKey(userId), JSON.stringify({ status, at: new Date().toISOString() })); } catch { /* local cache only */ }
      void supabase.from("app_tour_states").upsert(
        { user_id: userId, tour_version: TOUR_VERSION, status, updated_at: new Date().toISOString() },
        { onConflict: "user_id,tour_version" },
      ).then(() => {}, () => {});
    }
    setIndex(null);
  }, [userId]);

  useEffect(() => {
    if (!accessReady) { setIndex(null); return; }
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
          void navigate({ to: "/today" }).then(() => {
            if (!cancelled && getVerifiedMembership()?.userId === user.id) setIndex(0);
          }).catch(() => {});
        }, () => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [accessReady, family?.id, navigate]);

  useEffect(() => {
    if (index === null) return;
    cardRef.current?.focus({ preventScroll: true });
    // Freeze interaction with Today, including keyboard navigation, not its data.
    const background = Array.from(document.querySelectorAll<HTMLElement>(".app-shell-main, .app-shell-header, .app-shell-bottom-nav"));
    const previous = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); finish("dismissed"); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      background.forEach((element, i) => { element.inert = previous[i] ?? false; });
      document.removeEventListener("keydown", keyboard);
    };
  }, [index === null, finish]);

  return <TourContext.Provider value={start}>
    {children}
    {step && accessReady && createPortal(
      <div className="app-tour-layer fixed inset-0 z-[80] bg-tour-overlay" data-tour-tab={step.tab}>
        <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="app-tour-title" aria-describedby="app-tour-description" tabIndex={-1} className="app-tour-tooltip fixed left-1/2 flex w-[min(360px,calc(100vw-24px))] -translate-x-1/2 flex-col rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lifted outline-none">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="app-tour-title" className="text-lg font-bold">{step.title}</h2>
            <p className="shrink-0 text-xs font-semibold text-muted-foreground" aria-live="polite">{(index ?? 0) + 1} / {steps.length}</p>
          </div>
          <p id="app-tour-description" className="mt-1 flex-1 overflow-y-auto text-sm leading-relaxed">{step.description}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => finish("dismissed")}>Skip</Button>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, (value ?? 0) - 1))}><ArrowLeft />Back</Button>
              <Button size="sm" className="min-w-20" onClick={() => index === steps.length - 1 ? finish("completed") : setIndex((value) => Math.min(steps.length - 1, (value ?? 0) + 1))}>{index === steps.length - 1 ? <>Done<Check /></> : <>Next<ArrowRight /></>}</Button>
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
