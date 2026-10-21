import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isNativeApp } from "@/lib/native-auth";
import { hideNativeSplash } from "@/lib/native-splash";
import { hasCachedSession } from "@/lib/session-hint";

/**
 * The blue branded splash + heart reveal belong to the native app and phone
 * layouts only. Desktop/tablet browsers get a quiet neutral loader (CSS swaps
 * the look via the `native-shell` class and a width media query, so the
 * server-rendered HTML never needs to know the device).
 */
export function usesBrandedSplash(): boolean {
  if (typeof window === "undefined") return false;
  return isNativeApp() || window.matchMedia("(max-width: 767px)").matches;
}

/**
 * Full-screen startup screen. Matches the iOS LaunchScreen.storyboard exactly:
 * logo-blue background (#114476), the same 144px logo image, centered in the
 * full screen (fixed inset-0, so body safe-area padding can't shift it). The
 * message sits below the logo without moving it. Mounting it hides the native
 * splash. `revealing` cuts a growing heart-shaped hole from the logo's heart.
 */
export function StartupSplash({
  message = "Loading your calendar…",
  revealing = false,
  onRevealEnd,
  minimal = false,
}: {
  message?: string;
  revealing?: boolean;
  onRevealEnd?: () => void;
  /** Force the neutral loader (e.g. no stored session, so sign-in is likely next). */
  minimal?: boolean;
}) {
  useEffect(() => {
    if (isNativeApp()) document.documentElement.classList.add("native-shell");
    hideNativeSplash();
  }, []);

  // The document keeps its normal cream background and theme-color at all
  // times; only this fixed overlay is blue. The heart mask cuts through it to
  // the already-rendered calendar, so no page-level colour ever changes.
  const revealClass = revealing ? "heart-reveal" : "";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={revealing || undefined}
      onAnimationEnd={
        revealing ? (e) => { if (e.target === e.currentTarget) onRevealEnd?.(); } : undefined
      }
      data-minimal={minimal || undefined}
      className={`startup-splash-bg fixed inset-0 z-[60] ${revealing ? `${revealClass} pointer-events-none` : ""}`}
    >
      <img
        src="/launch-logo.png"
        alt=""
        width={144}
        height={144}
        decoding="sync"
        fetchPriority="high"
        className="startup-splash-logo absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 object-contain"
      />
      <p className="startup-splash-text absolute left-0 right-0 top-1/2 mt-[92px] text-center font-display text-sm font-semibold text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

/** One heart reveal per app launch — never on tab switches or foreground returns. */
let revealUsed = false;

/**
 * One-shot request for the heart reveal outside the initial launch — currently
 * onboarding's "Go to Calendar" finish. Resets the once-per-launch guard and
 * notifies the mounted reveal so it can hold again until the calendar is ready.
 */
let revealRequestVersion = 0;
const revealRequestListeners = new Set<() => void>();
export function requestHeartReveal(): void {
  revealUsed = false;
  revealRequestVersion += 1;
  revealRequestListeners.forEach((l) => l());
}
function subscribeRevealRequests(listener: () => void) {
  revealRequestListeners.add(listener);
  return () => void revealRequestListeners.delete(listener);
}

/**
 * Rendered over the live calendar once the shell mounts. Stays solid blue while
 * the first bundle loads, then opens with the heart. Load errors and reduced
 * motion skip the animation immediately.
 */
export function StartupHeartReveal({ loading, failed }: { loading: boolean; failed: boolean }) {
  const [phase, setPhase] = useState<"hold" | "reveal" | "done">(() =>
    revealUsed ? "done" : "hold",
  );
  const requestVersion = useSyncExternalStore(
    subscribeRevealRequests,
    () => revealRequestVersion,
    () => revealRequestVersion,
  );
  const seenRequestVersion = useRef(requestVersion);
  /** A finish request is waiting for its destination to become ready. */
  const requestedReveal = useRef(false);

  useEffect(() => {
    if (requestVersion === seenRequestVersion.current) return;
    seenRequestVersion.current = requestVersion;
    // A finish request arrives while the splash is done (e.g. onboarding):
    // hold again so the reveal waits for the calendar to be ready.
    requestedReveal.current = true;
    setPhase("hold");
  }, [requestVersion]);

  useEffect(() => {
    if (phase !== "hold" || loading) return;
    if (failed) {
      // A finish request (e.g. leaving onboarding) holds through the source
      // page's failed state until the destination is ready. Genuine load
      // errors end the splash immediately, and a bounded timeout guarantees
      // the overlay can never stick over an in-page error.
      if (!requestedReveal.current) {
        setPhase("done");
        return;
      }
      const t = window.setTimeout(() => setPhase("done"), 10_000);
      return () => window.clearTimeout(t);
    }
    requestedReveal.current = false;
    // eslint-disable-next-line consistent-return
    revealUsed = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Desktop/tablet browsers and signed-out visitors: no animation.
    if (reduce || !usesBrandedSplash() || !hasCachedSession()) {
      setPhase("done");
      return;
    }
    setPhase("reveal");
  }, [phase, loading, failed]);

  useEffect(() => {
    if (phase !== "reveal") return;
    // Safety net if animationend never fires.
    const t = window.setTimeout(() => setPhase("done"), 2000);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "done") return null;
  return <StartupSplash minimal={!isNativeApp() && !hasCachedSession()} revealing={phase === "reveal"} onRevealEnd={() => setPhase("done")} />;
}
