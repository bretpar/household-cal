import { useCallback, useEffect, useState, type ForwardedRef } from "react";

const TYPING = "input, textarea, [contenteditable='true']";

export function isTypingElement(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.matches(TYPING);
}

/**
 * Track the keyboard's visible viewport without moving focus or the document.
 *
 * Event sheets (scrollResetKey set) follow one simple model on phones:
 * - the outer sheet never scrolls; only [data-event-form-scroll] does;
 * - keyboard open: geometry is applied once, then only settled height changes
 *   (>=8px) update it, so pans and focus changes never re-anchor the sheet;
 * - only an obscured focused field is revealed after viewport movement settles.
 */
export function useModalViewport<T extends HTMLElement>(forwardedRef: ForwardedRef<T>, scrollResetKey?: string) {
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((value: T | null) => {
    setNode(value);
    if (typeof forwardedRef === "function") forwardedRef(value);
    else if (forwardedRef) forwardedRef.current = value;
  }, [forwardedRef]);

  useEffect(() => {
    if (!node || scrollResetKey === undefined || !window.matchMedia("(max-width: 639px)").matches) return;
    const reset = () => {
      node.scrollTop = 0;
      node.querySelectorAll<HTMLElement>("[data-event-form-scroll]").forEach((scroller) => {
        scroller.scrollTop = 0;
      });
    };
    reset();
  }, [node, scrollResetKey]);

  useEffect(() => {
    if (!node) return;
    const eventSheet = scrollResetKey !== undefined;
    const viewport = window.visualViewport;
    const mobile = window.matchMedia("(max-width: 639px)");
    let frame = 0;
    let settle = 0;
    let previousHeight = viewport?.height ?? window.innerHeight;
    let revealAllowed = false;

    // Scroll only the form scroller (or the dialog itself for other dialogs),
    // never scrollIntoView, which can pan Safari's page.
    const revealFocused = () => {
      if (!mobile.matches) return;
      const active = document.activeElement;
      if (!isTypingElement(active) || !node.contains(active)) return;
      const scroller = eventSheet
        ? active.closest<HTMLElement>("[data-event-form-scroll]")
        : node;
      if (!scroller || !node.contains(scroller)) return;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const field = active.getBoundingClientRect();
      const bounds = scroller.getBoundingClientRect();
      const upper = Math.max(bounds.top, top) + 12;
      const lower = Math.min(bounds.bottom, top + height) - 12;
      if (lower - upper < 24) return;
      if (field.bottom > lower) scroller.scrollTop += Math.min(field.bottom - lower, field.top - upper);
      else if (field.top < upper) scroller.scrollTop -= upper - field.top;
    };

    let exitTimer = 0;
    let applyTimer = 0;
    let applied = { height: -1, bottom: -1 };
    const read = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      return { height, bottom: Math.max(0, window.innerHeight - top - height) };
    };
    const apply = (g: { height: number; bottom: number }) => {
      applied = g;
      node.style.setProperty("--modal-visible-height", `${g.height}px`);
      node.style.setProperty("--modal-visible-bottom", `${g.bottom}px`);
    };
    // Keyboard open when a substantial bottom slice of the window is covered.
    const KEYBOARD = 120;
    const position = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!mobile.matches) {
          window.clearTimeout(exitTimer);
          window.clearTimeout(applyTimer);
          node.style.removeProperty("--modal-visible-height");
          node.style.removeProperty("--modal-visible-bottom");
          delete node.dataset["keyboard"];
          return;
        }
        const g = read();
        if (!eventSheet) return apply(g);
        const isOpen = node.dataset["keyboard"] === "open";
        if (g.bottom > KEYBOARD) {
          window.clearTimeout(exitTimer);
          if (!isOpen) {
            apply(g);
            node.dataset["keyboard"] = "open";
            return;
          }
          // Anchored above the keyboard: ignore pan/focus jitter and coalesce
          // real keyboard-height changes into one settled update.
          if (Math.abs(g.height - applied.height) < 8 && Math.abs(g.bottom - applied.bottom) < 8) return;
          window.clearTimeout(applyTimer);
          applyTimer = window.setTimeout(() => {
            const next = read();
            if (node.dataset["keyboard"] === "open" && next.bottom > KEYBOARD) apply(next);
          }, 160);
          return;
        }
        if (!isOpen) return apply(g);
        const exit = () => {
          window.clearTimeout(applyTimer);
          delete node.dataset["keyboard"];
          apply(read());
        };
        // Moving between fields can briefly drop the keyboard; stay compact unless it really closed.
        const active = document.activeElement;
        window.clearTimeout(exitTimer);
        if (isTypingElement(active) && node.contains(active)) {
          exitTimer = window.setTimeout(() => {
            if (read().bottom <= KEYBOARD) exit();
          }, 250);
        } else exit();
      });
    };

    const scheduleReveal = () => {
      window.clearTimeout(settle);
      if (!eventSheet || revealAllowed) settle = window.setTimeout(revealFocused, 180);
    };
    // A growing viewport restores CSS layout, not the form's scroll position.
    // Resize and pan share one settle callback rather than competing corrections.
    const onResize = () => {
      const height = viewport?.height ?? window.innerHeight;
      if (eventSheet) {
        if (height > previousHeight + 1) revealAllowed = false;
        else if (height < previousHeight - 1) revealAllowed = true;
        previousHeight = height;
      }
      position();
      scheduleReveal();
    };
    const onViewportScroll = () => {
      position();
      if (eventSheet) scheduleReveal();
    };
    const onFocusIn = () => {
      revealAllowed = true;
      scheduleReveal();
    };
    const onFocusOut = () => {
      if (eventSheet) {
        revealAllowed = false;
        window.clearTimeout(settle);
      }
    };

    position();
    viewport?.addEventListener("resize", onResize);
    viewport?.addEventListener("scroll", onViewportScroll);
    window.addEventListener("resize", onResize);
    mobile.addEventListener("change", onResize);
    node.addEventListener("focusin", onFocusIn);
    node.addEventListener("focusout", onFocusOut);
    // Event sheets: a genuine tap on blank sheet space dismisses the keyboard, not the sheet.
    const blurOnBlankTap = (event: MouseEvent) => {
      if (!eventSheet || !mobile.matches) return;
      const active = document.activeElement;
      if (!isTypingElement(active)) return;
      const target = event.target;
      if (target instanceof Element &&
          target.closest("input, textarea, select, button, label, a, [role='combobox'], [role='option'], [role='switch'], [role='checkbox'], [contenteditable='true']")) return;
      active.blur();
    };
    node.addEventListener("click", blurOnBlankTap);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.clearTimeout(exitTimer);
      window.clearTimeout(applyTimer);
      viewport?.removeEventListener("resize", onResize);
      viewport?.removeEventListener("scroll", onViewportScroll);
      window.removeEventListener("resize", onResize);
      mobile.removeEventListener("change", onResize);
      node.removeEventListener("focusin", onFocusIn);
      node.removeEventListener("focusout", onFocusOut);
      node.removeEventListener("click", blurOnBlankTap);
    };
  }, [node, scrollResetKey]);
  return ref;
}
