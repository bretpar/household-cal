import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * One continuous horizontal strip of fixed-width day columns.
 *
 * The strip is a single persistent scroll surface: the mounted range of days
 * never changes during a gesture, so the content follows the finger without any
 * rerender or page swap. On release the strip coasts briefly and then eases into
 * the nearest single-day column — never more than one day per gesture — and only
 * then reports the new index so the header can update without moving the track.
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
  /** called once the settle animation has finished */
  onIndexChange: (index: number) => void;
  /** haptic / a11y hook fired when a gesture commits to a new day */
  onNavigate?: (() => void) | undefined;
  /** while true (long-press event drag) the strip never claims a gesture */
  isBlocked?: (() => boolean) | undefined;
  /** changing this re-aligns the strip instantly (window rebase, Today, view change) */
  alignKey: string | number;
  /** desktop: use native scrolling + soft settle instead of touch gesture handling */
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
    node.scrollLeft = indexRef.current * columnWidth;
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

    const AXIS_THRESHOLD = 10;
    /** 32% of a column, or a clear flick, advances exactly one day */
    const DISTANCE_RATIO = 0.32;
    const FLICK_VELOCITY = 0.45; // px per ms

    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let axis: "undecided" | "x" | "y" = "undecided";
    let active = false;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let intended: number | null = null;

    const track = () => node.firstElementChild as HTMLElement | null;

    const overlayOpen = () =>
      !!document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      );

    const maxScroll = () => Math.max(0, node.scrollWidth - node.clientWidth);

    const clearShift = () => {
      const el = track();
      if (el && el.style.transform) el.style.transform = "";
    };

    // iOS ignores programmatic scrollLeft writes mid-gesture, so whatever the
    // engine refuses is compensated with a transform on the track: the content
    // always tracks the finger 1:1.
    const applyIntended = (next: number) => {
      const clamped = Math.max(0, Math.min(maxScroll(), next));
      intended = clamped;
      node.scrollLeft = clamped;
      const el = track();
      if (el) {
        const shift = node.scrollLeft - clamped;
        el.style.transform = shift ? `translate3d(${shift}px, 0, 0)` : "";
      }
    };

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

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || isBlockedRef.current?.() || overlayOpen()) {
        active = false;
        axis = "undecided";
        return;
      }
      cancelAnimation();
      settling.current = false;
      active = true;
      axis = "undecided";
      intended = null;
      velocity = 0;
      startX = lastX = touch.clientX;
      startY = touch.clientY;
      lastT = performance.now();
      startScrollLeft = node.scrollLeft;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      if (isBlockedRef.current?.()) {
        active = false;
        axis = "undecided";
        clearShift();
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (axis === "undecided") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_THRESHOLD) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis !== "x") return;
      if (e.cancelable) e.preventDefault();

      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) {
        const sample = (touch.clientX - lastX) / dt;
        // Light smoothing keeps flick detection stable without lagging.
        velocity = velocity * 0.4 + sample * 0.6;
      }
      lastX = touch.clientX;
      lastT = now;
      applyIntended(startScrollLeft - dx);
    };

    const onTouchEnd = () => {
      if (!active || axis !== "x") {
        active = false;
        axis = "undecided";
        return;
      }
      active = false;
      axis = "undecided";
      if (intended != null) node.scrollLeft = intended;
      clearShift();

      const current = indexRef.current;
      const dragged = node.scrollLeft - current * columnWidth;
      // Finger moving left (negative velocity) advances forward in time.
      const scrollVelocity = -velocity;
      const flick = Math.abs(scrollVelocity) >= FLICK_VELOCITY;
      const far = Math.abs(dragged) >= columnWidth * DISTANCE_RATIO;
      let direction = 0;
      if (far) direction = dragged > 0 ? 1 : -1;
      else if (flick) direction = scrollVelocity > 0 ? 1 : -1;
      // Never skip: exactly one day per gesture.
      settleTo(current + direction, scrollVelocity);
      velocity = 0;
      intended = null;
    };

    // Desktop trackpad: horizontal pans the strip and never the browser history.
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      if (isBlockedRef.current?.() || overlayOpen()) return;
      const unit = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * unit;
      if (Math.abs(dx) <= Math.abs(e.deltaY * unit) || Math.abs(dx) < 1) return;
      e.preventDefault();
      cancelAnimation();
      node.scrollLeft = Math.max(0, Math.min(maxScroll(), node.scrollLeft + dx));
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelTimer = null;
        const nearest = Math.round(node.scrollLeft / columnWidth);
        settleTo(nearest, 0);
      }, 140);
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
        settleTo(Math.round(node.scrollLeft / columnWidth), 0);
      }, 130);
    };

    if (native) {
      node.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        if (settleTimer) clearTimeout(settleTimer);
        cancelAnimation();
        node.removeEventListener("scroll", onScroll);
      };
    }

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (wheelTimer) clearTimeout(wheelTimer);
      clearShift();
      cancelAnimation();
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
      node.removeEventListener("wheel", onWheel);
    };
  }, [cancelAnimation, columnWidth, native]);


  return { hostRef, align };
}
