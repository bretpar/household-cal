import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * One continuous horizontal strip of fixed-width day columns.
 *
 * The strip is a single persistent scroll surface: the mounted range of days
 * never changes during a gesture. Mobile scrolling and settling belong to the
 * browser; dates are committed only after reaching a gutter-aware snap target.
 * Desktop retains its existing trackpad soft settle.
 */
export function useDayStrip({
  columnWidth,
  index,
  onIndexChange,
  onNavigate,
  isBlocked,
  alignKey,
  native = false,
  onVisibleIndexChange,
}: {
  /** width of one day column in px (0 while measuring) */
  columnWidth: number;
  /** logical index of the left-most visible day inside the mounted window */
  index: number;
  /** called only after the scroll position has settled */
  onIndexChange: (index: number) => void;
  /** haptic / a11y hook fired when a gesture commits to a new day */
  onNavigate?: (() => void) | undefined;
  /** while true (long-press event drag) the strip never claims a gesture */
  isBlocked?: (() => boolean) | undefined;
  /** changing this re-aligns the strip instantly (window rebase, Today, view change) */
  alignKey: string | number;
  /** desktop trackpad behavior; mobile uses CSS native scroll snapping */
  native?: boolean;
  /** live left-most visible day index while scrolling (header only; never repositions) */
  onVisibleIndexChange?: ((index: number) => void) | undefined;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const animation = useRef<number | null>(null);
  const settling = useRef(false);

  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const isBlockedRef = useRef(isBlocked);
  isBlockedRef.current = isBlocked;
  const onVisibleIndexChangeRef = useRef(onVisibleIndexChange);
  onVisibleIndexChangeRef.current = onVisibleIndexChange;


  const cancelAnimation = useCallback(() => {
    if (animation.current == null) return;
    cancelAnimationFrame(animation.current);
    animation.current = null;
  }, []);

  /** Snap the track to the current index with zero animation and zero jump. */
  const align = useCallback(() => {
    const node = hostRef.current;
    if (!node || columnWidth <= 0) return;
    cancelAnimation();
    // Only the horizontal coordinate changes; the mounted timeline keeps its hour.
    node.scrollTo({ left: indexRef.current * columnWidth, behavior: "instant" });
  }, [cancelAnimation, columnWidth]);

  // Re-align only outside gestures: during a drag or settle the visual position
  // is authoritative, so index/window changes must not move the track.
  useLayoutEffect(() => {
    if (settling.current) return;
    align();
  }, [align, alignKey, columnWidth, index]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || columnWidth <= 0) return;

    const overlayOpen = () =>
      !!document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      );

    const maxScroll = () => Math.max(0, node.scrollWidth - node.clientWidth);

    if (!native) {
      /**
       * Mobile directional gesture controller. The surface declares
       * touch-action: none up front, so the browser never pans either axis;
       * after LOCK_PX of travel the dominant axis is locked for the whole
       * gesture and only that scroll coordinate is driven.
       */
      const LOCK_PX = 9;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let raf: number | null = null;
      let gesture: {
        id: number;
        x: number;
        y: number;
        left: number;
        top: number;
        axis: "none" | "x" | "y";
        samples: { t: number; x: number; y: number }[];
      } | null = null;
      let busy = false; // finger down or controller inertia running
      let suppressClickUntil = 0;
      let savedSnap: string | null = null;

      const clearTimer = () => {
        if (timer != null) clearTimeout(timer);
        timer = null;
      };
      const stopInertia = () => {
        if (raf != null) cancelAnimationFrame(raf);
        raf = null;
      };
      const suspendSnap = () => {
        if (savedSnap != null) return;
        savedSnap = node.style.scrollSnapType;
        node.style.scrollSnapType = "none";
      };
      const restoreSnap = () => {
        if (savedSnap == null) return;
        node.style.scrollSnapType = savedSnap;
        savedSnap = null;
      };
      const maxTop = () => Math.max(0, node.scrollHeight - node.clientHeight);
      const snapPosition = (targetIndex: number) => {
        // Measure the actual grid boundary, preserving fractional 3-Day widths.
        const target = node.querySelector<HTMLElement>(`[data-day-snap="${targetIndex}"]`);
        if (!target) return targetIndex * columnWidth;
        const gutter = parseFloat(getComputedStyle(node).scrollPaddingLeft) || 0;
        return node.scrollLeft + target.getBoundingClientRect().left -
          node.getBoundingClientRect().left - node.clientLeft - gutter;
      };
      const finish = () => {
        clearTimer();
        if (busy || isBlockedRef.current?.() || overlayOpen()) return;
        const lastIndex = Math.max(0, Math.round(maxScroll() / columnWidth));
        const actualIndex = Math.max(0, Math.min(lastIndex, Math.round(node.scrollLeft / columnWidth)));
        const target = Math.max(0, Math.min(maxScroll(), snapPosition(actualIndex)));
        if (Math.abs(node.scrollLeft - target) > 0.75) {
          // Recovery only after all movement stops.
          node.scrollTo({ left: target, behavior: "instant" });
          schedule();
          return;
        }
        onVisibleIndexChangeRef.current?.(actualIndex);
        if (actualIndex !== indexRef.current) {
          onNavigateRef.current?.();
          onIndexChangeRef.current(actualIndex);
        }
      };
      const schedule = () => {
        clearTimer();
        timer = setTimeout(finish, 180);
      };
      const settled = () => {
        busy = false;
        raf = null;
        restoreSnap();
        schedule();
      };

      const abandon = () => {
        gesture = null;
        stopInertia();
        settled();
      };

      const onTouchStart = (event: TouchEvent) => {
        // New contact always cancels controller inertia.
        stopInertia();
        clearTimer();
        if (event.touches.length !== 1) {
          // Multitouch: drop the gesture and settle where we are.
          if (gesture) abandon();
          return;
        }
        const t = event.touches[0]!;
        busy = true;
        gesture = {
          id: t.identifier,
          x: t.clientX,
          y: t.clientY,
          left: node.scrollLeft,
          top: node.scrollTop,
          axis: "none",
          samples: [{ t: performance.now(), x: t.clientX, y: t.clientY }],
        };
      };

      const onTouchMove = (event: TouchEvent) => {
        const g = gesture;
        if (!g) return;
        // An established event drag owns the touch.
        if (isBlockedRef.current?.()) {
          gesture = null;
          return;
        }
        const t = Array.from(event.touches).find((touch) => touch.identifier === g.id);
        if (!t || event.touches.length !== 1) return;
        const dx = t.clientX - g.x;
        const dy = t.clientY - g.y;
        if (g.axis === "none") {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
          g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (g.axis === "x") suspendSnap();
          suppressClickUntil = Number.POSITIVE_INFINITY;
        }
        if (event.cancelable) event.preventDefault();
        if (g.axis === "x") {
          node.scrollLeft = Math.max(0, Math.min(maxScroll(), g.left - dx));
        } else {
          node.scrollTop = Math.max(0, Math.min(maxTop(), g.top - dy));
        }
        const now = performance.now();
        g.samples.push({ t: now, x: t.clientX, y: t.clientY });
        while (g.samples.length > 2 && now - g.samples[0]!.t > 100) g.samples.shift();
      };

      const velocity = (g: NonNullable<typeof gesture>) => {
        const first = g.samples[0]!;
        const last = g.samples[g.samples.length - 1]!;
        const dt = last.t - first.t;
        if (dt <= 0 || performance.now() - last.t > 80) return 0;
        // px/ms in scroll direction (finger left = scroll right).
        return g.axis === "x" ? -(last.x - first.x) / dt : -(last.y - first.y) / dt;
      };

      const glideX = (v: number, startIndex: number) => {
        const projected = node.scrollLeft + v * 160;
        const lastIndex = Math.max(0, Math.round(maxScroll() / columnWidth));
        let targetIndex = Math.round(projected / columnWidth);
        targetIndex = Math.max(startIndex - 3, Math.min(startIndex + 3, targetIndex));
        targetIndex = Math.max(0, Math.min(lastIndex, targetIndex));
        const from = node.scrollLeft;
        const to = Math.max(0, Math.min(maxScroll(), snapPosition(targetIndex)));
        const distance = to - from;
        if (Math.abs(distance) < 0.5) {
          node.scrollLeft = to;
          settled();
          return;
        }
        const duration = 220 + 140 * Math.min(1, Math.abs(distance) / Math.max(1, columnWidth));
        const startedAt = performance.now();
        const frame = (now: number) => {
          const u = Math.min(1, (now - startedAt) / duration);
          const eased = 1 - Math.pow(1 - u, 3);
          node.scrollLeft = from + distance * eased;
          if (u < 1) {
            raf = requestAnimationFrame(frame);
            return;
          }
          node.scrollLeft = to;
          settled();
        };
        raf = requestAnimationFrame(frame);
      };

      const glideY = (v0: number) => {
        let v = Math.max(-4, Math.min(4, v0));
        if (Math.abs(v) < 0.05) {
          settled();
          return;
        }
        let last = performance.now();
        const frame = (now: number) => {
          const dt = Math.min(32, now - last);
          last = now;
          const before = node.scrollTop;
          node.scrollTop = Math.max(0, Math.min(maxTop(), before + v * dt));
          v *= Math.pow(0.996, dt);
          if (Math.abs(v) < 0.03 || node.scrollTop === before) {
            settled();
            return;
          }
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      };

      const onTouchEnd = (event: TouchEvent) => {
        const g = gesture;
        if (!g) {
          if (event.touches.length === 0 && raf == null) settled();
          return;
        }
        if (Array.from(event.touches).some((touch) => touch.identifier === g.id)) return;
        gesture = null;
        if (g.axis === "none") {
          // A tap or held press: nothing moved.
          suppressClickUntil = 0;
          settled();
          return;
        }
        // Swallow the click the browser may synthesize after a swipe.
        suppressClickUntil = performance.now() + 400;
        if (event.type === "touchcancel" || isBlockedRef.current?.()) {
          if (g.axis === "x") glideX(0, Math.round(g.left / columnWidth));
          else settled();
          return;
        }
        const v = velocity(g);
        if (g.axis === "x") glideX(v, Math.round(g.left / columnWidth));
        else glideY(v);
      };

      const onClickCapture = (event: MouseEvent) => {
        if (performance.now() > suppressClickUntil) return;
        suppressClickUntil = 0;
        event.stopPropagation();
        event.preventDefault();
      };

      const onScroll = () => {
        // Programmatic jumps (arrows, Today, rebase) still settle; controller
        // movement waits for its own settle.
        if (!busy) schedule();
      };
      const onResize = () => {
        if (gesture) abandon();
      };

      node.addEventListener("touchstart", onTouchStart, { passive: true });
      node.addEventListener("touchmove", onTouchMove, { passive: false });
      node.addEventListener("touchend", onTouchEnd, { passive: true });
      node.addEventListener("touchcancel", onTouchEnd, { passive: true });
      node.addEventListener("click", onClickCapture, true);
      node.addEventListener("scroll", onScroll, { passive: true });
      node.addEventListener("scrollend", onScroll);
      window.addEventListener("orientationchange", onResize);
      window.addEventListener("resize", onResize);
      return () => {
        clearTimer();
        stopInertia();
        restoreSnap();
        node.removeEventListener("touchstart", onTouchStart);
        node.removeEventListener("touchmove", onTouchMove);
        node.removeEventListener("touchend", onTouchEnd);
        node.removeEventListener("touchcancel", onTouchEnd);
        node.removeEventListener("click", onClickCapture, true);
        node.removeEventListener("scroll", onScroll);
        node.removeEventListener("scrollend", onScroll);
        window.removeEventListener("orientationchange", onResize);
        window.removeEventListener("resize", onResize);
      };
    }

    const reduceMotion = () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    /**
     * Coast-then-settle: a cubic Hermite curve that leaves the finger at the
     * release velocity and arrives at the target with zero velocity, so there is
     * no bounce and no hard snap.
     */
    const settleTo = (targetIndex: number, v0: number) => {
      const from = node.scrollLeft;
      const to = Math.max(0, Math.min(maxScroll(), targetIndex * columnWidth));
      const distance = to - from;
      const commit = () => {
        settling.current = false;
        node.scrollLeft = to;
        if (targetIndex !== indexRef.current) {
          onNavigateRef.current?.();
          onIndexChangeRef.current(targetIndex);
        }
      };

      if (reduceMotion() || Math.abs(distance) < 0.5) {
        commit();
        return;
      }

      // 250ms for a nudge, up to 400ms for a full column of travel.
      const duration = 250 + 150 * Math.min(1, Math.abs(distance) / Math.max(1, columnWidth));
      // Only keep momentum that points at the target, and never enough to overshoot.
      const sameWay = Math.sign(v0) === Math.sign(distance);
      const m0 = sameWay
        ? Math.sign(distance) * Math.min(Math.abs(v0) * duration, Math.abs(distance) * 2.2)
        : 0;

      settling.current = true;
      const startedAt = performance.now();
      const frame = (nowMs: number) => {
        const u = Math.min(1, (nowMs - startedAt) / duration);
        const u2 = u * u;
        const u3 = u2 * u;
        const position =
          from * (2 * u3 - 3 * u2 + 1) + m0 * (u3 - 2 * u2 + u) + to * (-2 * u3 + 3 * u2);
        node.scrollLeft = position;
        if (u < 1) {
          animation.current = requestAnimationFrame(frame);
          return;
        }
        animation.current = null;
        commit();
      };
      cancelAnimation();
      animation.current = requestAnimationFrame(frame);
    };

    // Desktop trackpad: horizontal pans the strip and never the browser history.
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      if (isBlockedRef.current?.() || overlayOpen()) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      // Vertical-dominant gestures belong to the timeline.
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 1) return;
      e.preventDefault();
      cancelAnimation();
      settling.current = false;
      node.scrollLeft = Math.max(0, Math.min(maxScroll(), node.scrollLeft + dx));
      onVisibleIndexChangeRef.current?.(Math.round(node.scrollLeft / columnWidth));
      if (wheelTimer) clearTimeout(wheelTimer);
      // Let the momentum stream finish before easing to the nearest column.
      wheelTimer = setTimeout(() => {
        wheelTimer = null;
        if (isBlockedRef.current?.()) return;
        settleTo(Math.round(node.scrollLeft / columnWidth), 0);
      }, 160);
    };

    // Desktop: let the browser own the pan and its momentum. We only watch the
    // resulting scroll position — reporting the visible day as it moves and
    // gently aligning to the nearest column once movement stops. No delta
    // thresholds, no page swaps, and no cap on days travelled per gesture.
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (settling.current) return;
      const visible = Math.round(node.scrollLeft / columnWidth);
      onVisibleIndexChangeRef.current?.(visible);
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (isBlockedRef.current?.()) return;
        if (wheelTimer) return; // a wheel stream is still running; it owns the settle
        settleTo(Math.round(node.scrollLeft / columnWidth), 0);
      }, 130);
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (wheelTimer) clearTimeout(wheelTimer);
      cancelAnimation();
      node.removeEventListener("scroll", onScroll);
      node.removeEventListener("wheel", onWheel);
    };
  }, [alignKey, cancelAnimation, columnWidth, native]);

  return { hostRef, align };
}
