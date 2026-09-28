import { useEffect, useState } from "react";

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
      onAnimationEnd={revealing ? onRevealEnd : undefined}
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
      <p className="startup-splash-text absolute left-0 right-0 top-1/2 mt-[92px] text-center font-display text-sm font-semibold text-primary-foreground/70">
        {message}
      </p>
    </div>
  );
}

/** One heart reveal per app launch — never on tab switches or foreground returns. */
let revealUsed = false;

/**
 * Rendered over the live calendar once the shell mounts. Stays solid blue while
 * the first bundle loads, then opens with the heart. Load errors and reduced
 * motion skip the animation immediately.
 */
export function StartupHeartReveal({ loading, failed }: { loading: boolean; failed: boolean }) {
  const [phase, setPhase] = useState<"hold" | "reveal" | "done">(() =>
    revealUsed ? "done" : "hold",
  );

  useEffect(() => {
    if (phase !== "hold" || loading) return;
    revealUsed = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Desktop/tablet browsers and signed-out visitors: no animation.
    if (failed || reduce || !usesBrandedSplash() || !hasCachedSession()) {
      setPhase("done");
      return;
    }
    setPhase("reveal");
  }, [phase, loading, failed]);

  useEffect(() => {
    if (phase !== "reveal") return;
    // Safety net if animationend never fires.
    const t = window.setTimeout(() => setPhase("done"), 1500);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "done") return null;
  return <StartupSplash minimal={!isNativeApp() && !hasCachedSession()} revealing={phase === "reveal"} onRevealEnd={() => setPhase("done")} />;
}
