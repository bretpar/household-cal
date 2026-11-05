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
 * - viewport pans/resizes use the same geometry (CSS vars);
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

    const position = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!mobile.matches) {
          node.style.removeProperty("--modal-visible-height");
          node.style.removeProperty("--modal-visible-bottom");
          delete node.dataset["keyboard"];
          return;
        }
        const height = viewport?.height ?? window.innerHeight;
        const top = viewport?.offsetTop ?? 0;
        const bottom = Math.max(0, window.innerHeight - top - height);
        node.style.setProperty("--modal-visible-height", `${height}px`);
        node.style.setProperty("--modal-visible-bottom", `${bottom}px`);
        // Keyboard open when a substantial bottom slice of the window is covered.
        if (eventSheet && bottom > 120) node.dataset["keyboard"] = "open";
        else delete node.dataset["keyboard"];
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
