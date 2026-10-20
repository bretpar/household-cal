import { useCallback, useEffect, useState, type ForwardedRef } from "react";

/** Track the keyboard's visible viewport without moving focus or the document. */
export function useModalViewport<T extends HTMLElement>(forwardedRef: ForwardedRef<T>) {
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((value: T | null) => {
    setNode(value);
    if (typeof forwardedRef === "function") forwardedRef(value);
    else if (forwardedRef) forwardedRef.current = value;
  }, [forwardedRef]);

  useEffect(() => {
    if (!node) return;
    const viewport = window.visualViewport;
    const mobile = window.matchMedia("(max-width: 639px)");
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!mobile.matches) {
          node.style.removeProperty("--modal-visible-height");
          node.style.removeProperty("--modal-visible-bottom");
          return;
        }
        const height = viewport?.height ?? window.innerHeight;
        const top = viewport?.offsetTop ?? 0;
        node.style.setProperty("--modal-visible-height", `${height}px`);
        node.style.setProperty("--modal-visible-bottom", `${Math.max(0, window.innerHeight - top - height)}px`);
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !node.contains(active) ||
            !active.matches("input, textarea, [contenteditable='true']")) return;
        // Scroll only modal ancestors, never scrollIntoView (which can pan Safari's page).
        let scroller: HTMLElement | null = active.parentElement;
        while (scroller && node.contains(scroller)) {
          if (/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
            const field = active.getBoundingClientRect();
            const bounds = scroller.getBoundingClientRect();
            const upper = Math.max(bounds.top, top) + 12;
            const lower = Math.min(bounds.bottom, top + height) - 12;
            if (field.bottom > lower) scroller.scrollTop += field.bottom - lower;
            else if (field.top < upper) scroller.scrollTop -= upper - field.top;
          }
          if (scroller === node) break;
          scroller = scroller.parentElement;
        }
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    mobile.addEventListener("change", update);
    node.addEventListener("focusin", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      mobile.removeEventListener("change", update);
      node.removeEventListener("focusin", update);
    };
  }, [node]);
  return ref;
}