import { useCallback, useEffect, useState, type ForwardedRef } from "react";

const TYPING = "input, textarea, [contenteditable='true']";


// ---- TEMPORARY keyboard diagnostics (remove with all `kbLog` calls). ----
// Enable: open any page with ?kbdiag=1 (persists); disable with ?kbdiag=0.
// Logs geometry/timing only — never field values, names or event content.
const KB_KEY = "ofc-kbdiag";
const KB_TRACE = "ofc-kbdiag-trace";
let kbOn: boolean | null = null;
let kbBuf: string[] = [];
let kbT0 = 0;
function kbEnabled() {
  if (kbOn !== null) return kbOn;
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("kbdiag");
    if (q === "1") localStorage.setItem(KB_KEY, "1");
    if (q === "0") { localStorage.removeItem(KB_KEY); localStorage.removeItem(KB_TRACE); }
    kbOn = localStorage.getItem(KB_KEY) === "1";
    if (kbOn) { kbBuf = JSON.parse(localStorage.getItem(KB_TRACE) || "[]"); kbT0 = performance.now(); kbButton(); }
  } catch { kbOn = false; }
  return kbOn;
}
let kbSaveTimer = 0;
function kbLog(node: HTMLElement | null, tag: string, extra = "") {
  if (!kbEnabled()) return;
  const vv = window.visualViewport;
  const r = node?.getBoundingClientRect();
  const form = node?.querySelector<HTMLElement>("[data-event-form-scroll]");
  const a = document.activeElement;
  const f = (n: number | undefined) => (n === undefined ? "-" : Math.round(n));
  kbBuf.push([
    f(performance.now() - kbT0), tag,
    `ih=${f(window.innerHeight)} vh=${f(vv?.height)} vt=${f(vv?.offsetTop)}`,
    r ? `sheet=${f(r.top)}..${f(r.bottom)}` : "sheet=-",
    `fs=${f(form?.scrollTop)} kb=${node?.dataset["keyboard"] ?? "-"}`,
    `act=${a instanceof HTMLElement ? a.tagName.toLowerCase() + (a instanceof HTMLInputElement ? ":" + a.type : "") : "-"}`,
    extra,
  ].join(" "));
  if (kbBuf.length > 1500) kbBuf = kbBuf.slice(-1500);
  window.clearTimeout(kbSaveTimer);
  kbSaveTimer = window.setTimeout(() => { try { localStorage.setItem(KB_TRACE, JSON.stringify(kbBuf)); } catch { /* full */ } }, 300);
}
// Bounded rAF trace (~1s) to separate browser movement from app writes.
let kbRafUntil = 0;
function kbRafTrace(node: HTMLElement, why: string) {
  if (!kbEnabled()) return;
  const running = performance.now() < kbRafUntil;
  kbRafUntil = performance.now() + 1000;
  kbLog(node, "raf-start", why);
  if (running) return;
  const tick = () => {
    if (performance.now() > kbRafUntil || !node.isConnected) return kbLog(node, "raf-end");
    kbLog(node, "raf");
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// Floating button (outside dialogs): close the sheet first, then tap to copy.
function kbButton() {
  const add = () => {
    if (document.getElementById("kbdiag-btn")) return;
    const b = document.createElement("button");
    b.id = "kbdiag-btn";
    b.textContent = "KB trace";
    b.style.cssText = "position:fixed;left:8px;top:calc(env(safe-area-inset-top) + 8px);z-index:2147483647;font:12px system-ui;padding:6px 10px;border-radius:8px;background:#333;color:#fff;opacity:.8";
    b.onclick = () => {
      const text = kbBuf.join("\n") || "(empty)";
      const choice = window.prompt("Type C to copy, X to clear trace", "C");
      if (choice?.toUpperCase() === "X") { kbBuf = []; localStorage.removeItem(KB_TRACE); return; }
      if (choice?.toUpperCase() !== "C") return;
      const fallback = () => {
        const t = document.createElement("textarea");
        t.value = text; t.style.cssText = "position:fixed;inset:10% 5%;z-index:2147483647;width:90%;height:80%;font:10px monospace";
        document.body.appendChild(t); t.focus(); t.select();
        t.onblur = () => t.remove();
      };
      navigator.clipboard?.writeText(text).then(() => alert(`Copied ${kbBuf.length} lines`), fallback) ?? fallback();
    };
    document.body.appendChild(b);
  };
  if (document.body) add(); else window.addEventListener("DOMContentLoaded", add);
}
// ---- end diagnostics ----

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
      kbLog(node, "reveal-check", `fieldTop=${Math.round(field.top)} fieldBot=${Math.round(field.bottom)} lo=${Math.round(upper)} hi=${Math.round(lower)}`);
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
      kbLog(node, "geom-write", `h=${Math.round(g.height)} b=${Math.round(g.bottom)}`);
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
            kbLog(node, "kb-open");
            kbRafTrace(node, "open");
            return;
          }
          // Anchored above the keyboard: ignore pan/focus jitter and coalesce
          // real keyboard-height changes into one settled update.
          if (Math.abs(g.height - applied.height) < 8 && Math.abs(g.bottom - applied.bottom) < 8) return;
          window.clearTimeout(applyTimer);
          kbLog(node, "apply-timer-set");
          applyTimer = window.setTimeout(() => {
            const next = read();
            kbLog(node, "apply-timer-fire");
            if (node.dataset["keyboard"] === "open" && next.bottom > KEYBOARD) apply(next);
          }, 160);
          return;
        }
        if (!isOpen) return apply(g);
        const exit = () => {
          window.clearTimeout(applyTimer);
          delete node.dataset["keyboard"];
          apply(read());
          kbLog(node, "kb-closed");
          kbRafTrace(node, "close");
        };
        // Moving between fields can briefly drop the keyboard; stay compact unless it really closed.
        const active = document.activeElement;
        window.clearTimeout(exitTimer);
        if (isTypingElement(active) && node.contains(active)) {
          kbLog(node, "exit-timer-set");
          exitTimer = window.setTimeout(() => {
            kbLog(node, "exit-timer-fire");
            if (read().bottom <= KEYBOARD) exit();
          }, 250);
        } else exit();
      });
    };

    const scheduleReveal = () => {
      window.clearTimeout(settle);
      if (!eventSheet || revealAllowed) {
        kbLog(node, "reveal-timer-set");
        settle = window.setTimeout(() => { kbLog(node, "reveal-timer-fire"); revealFocused(); kbLog(node, "reveal-done"); }, 180);
      }
    };
    // A growing viewport restores CSS layout, not the form's scroll position.
    // Resize and pan share one settle callback rather than competing corrections.
    const onResize = () => {
      kbLog(node, "resize");
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
      kbLog(node, "vv-scroll");
      position();
      if (eventSheet) scheduleReveal();
    };
    const onFocusIn = () => {
      kbLog(node, "focusin");
      if (eventSheet) kbRafTrace(node, "focus");
      revealAllowed = true;
      scheduleReveal();
    };
    const onFocusOut = () => {
      kbLog(node, "focusout");
      if (eventSheet) kbRafTrace(node, "blur");
      if (eventSheet) {
        revealAllowed = false;
        window.clearTimeout(settle);
      }
    };

    kbLog(node, "mount", eventSheet ? "event-sheet" : "dialog");
    const onFormScroll = (e: Event) => {
      if (e.target instanceof HTMLElement && e.target.matches("[data-event-form-scroll]")) kbLog(node, "form-scroll");
    };
    if (kbEnabled()) node.addEventListener("scroll", onFormScroll, true);
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
      node.removeEventListener("scroll", onFormScroll, true);
    };
  }, [node, scrollResetKey]);
  return ref;
}

// TEMPORARY: activate diagnostics on page load (after hydration) so the
// button appears without first opening a dialog.
if (typeof window !== "undefined") window.setTimeout(kbEnabled, 1500);
