/**
 * Hide the native iOS launch screen once the web app has painted something
 * that matches it. No-op on the web. The native side also auto-hides after
 * launchShowDuration (capacitor.config.ts), so a network failure can never
 * hold the splash indefinitely.
 */
let hidden = false;

export function hideNativeSplash() {
  if (hidden || typeof window === "undefined") return;
  hidden = true;
  void (async () => {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;
      const { SplashScreen } = await import("@capacitor/splash-screen");
      // Wait one frame so the matching web splash is actually on screen.
      requestAnimationFrame(() => {
        void SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {});
      });
    } catch {
      // Plugin unavailable (older shell build) — native auto-hide still applies.
    }
  })();
}
