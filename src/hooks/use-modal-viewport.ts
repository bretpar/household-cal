import { useCallback, useEffect, useState, type ForwardedRef } from "react";

const TYPING = "input, textarea, [contenteditable='true']";

export function isTypingElement(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.matches(TYPING);
}

/**
 * Phone event sheets (scrollResetKey set) are stable full-screen editors:
 * no viewport geometry, no keyboard-driven positioning — iOS scrolls the
 * form region natively. The hook only resets their scroll position per mode
 * and lets a genuine tap on blank space dismiss the keyboard (never the
 * editor). Other mobile dialogs keep the visible-viewport geometry so tall
 * sheets clear the iOS keyboard.
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
    node.scrollTop = 0;
    node.querySelectorAll<HTMLElement>("[data-event-form-scroll]").forEach((scroller) => {
      scroller.scrollTop = 0;
    });
  }, [node, scrollResetKey]);

  useEffect(() => {
    if (!node) return;
    const mobile = window.matchMedia("(max-width: 639px)");

    if (scrollResetKey !== undefined) {
      // Full-screen editor: a tap on blank space only dismisses the keyboard.
      const blurOnBlankTap = (event: MouseEvent) => {
        if (!mobile.matches) return;
        const active = document.activeElement;
        if (!isTypingElement(active)) return;
        const target = event.target;
        if (target instanceof Element &&
            target.closest("input, textarea, select, button, label, a, [role='combobox'], [role='option'], [role='switch'], [role='checkbox'], [contenteditable='true']")) return;
        active.blur();
      };
      node.addEventListener("click", blurOnBlankTap);
      return () => node.removeEventListener("click", blurOnBlankTap);
    }

    const viewport = window.visualViewport;
    let frame = 0;
    let settle = 0;

    // Scroll only the dialog itself, never scrollIntoView, which can pan
    // Safari's page.
    const revealFocused = () => {
      if (!mobile.matches) return;
      const active = document.activeElement;
      if (!isTypingElement(active) || !node.contains(active)) return;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const field = active.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      const upper = Math.max(bounds.top, top) + 12;
      const lower = Math.min(bounds.bottom, top + height) - 12;
      if (lower - upper < 24) return;
      if (field.bottom > lower) node.scrollTop += Math.min(field.bottom - lower, field.top - upper);
      else if (field.top < upper) node.scrollTop -= upper - field.top;
    };

    const apply = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      node.style.setProperty("--modal-visible-height", `${height}px`);
      node.style.setProperty("--modal-visible-bottom", `${Math.max(0, window.innerHeight - top - height)}px`);
    };
    const position = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!mobile.matches) {
          node.style.removeProperty("--modal-visible-height");
          node.style.removeProperty("--modal-visible-bottom");
          return;
        }
        apply();
      });
    };
    const scheduleReveal = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(revealFocused, 180);
    };
    const onResize = () => {
      position();
      scheduleReveal();
    };

    position();
    viewport?.addEventListener("resize", onResize);
    viewport?.addEventListener("scroll", onResize);
    window.addEventListener("resize", onResize);
    mobile.addEventListener("change", onResize);
    node.addEventListener("focusin", scheduleReveal);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      viewport?.removeEventListener("resize", onResize);
      viewport?.removeEventListener("scroll", onResize);
      window.removeEventListener("resize", onResize);
      mobile.removeEventListener("change", onResize);
      node.removeEventListener("focusin", scheduleReveal);
    };
  }, [node, scrollResetKey]);
  return ref;
}
