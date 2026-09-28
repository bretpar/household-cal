import { useEffect, useState } from "react";

import { hideNativeSplash } from "@/lib/native-splash";

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
}: {
  message?: string;
  revealing?: boolean;
  onRevealEnd?: () => void;
}) {
  useEffect(() => {
    hideNativeSplash();
  }, []);

  // Paint the page itself blue while the splash is up so the status-bar /
  // Dynamic Island area (and any frame before the overlay paints) is solid
  // #114476 rather than the cream page background. Restored on unmount.
  useEffect(() => {
    const root = document.documentElement;
    const prevBg = root.style.backgroundColor;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = meta?.content;
    root.style.backgroundColor = "#114476";
    if (meta) meta.content = "#114476";
    return () => {
      root.style.backgroundColor = prevBg;
      if (meta && prevTheme !== undefined) meta.content = prevTheme;
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={revealing || undefined}
      onAnimationEnd={revealing ? onRevealEnd : undefined}
      className={`startup-splash-bg fixed inset-0 z-[60] ${revealing ? "heart-reveal pointer-events-none" : ""}`}
    >
      <img
        src="/launch-logo.png"
        alt=""
        width={144}
        height={144}
        decoding="sync"
        fetchPriority="high"
        className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 object-contain"
      />
      <p className="absolute left-0 right-0 top-1/2 mt-[92px] text-center font-display text-sm font-semibold text-primary-foreground/70">
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
    if (failed || reduce) {
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
  return <StartupSplash revealing={phase === "reveal"} onRevealEnd={() => setPhase("done")} />;
}
