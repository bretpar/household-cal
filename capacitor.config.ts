import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native iOS shell for Our Family Calendar.
 *
 * The shell loads the live, deployed OFC web app (server-rendered TanStack
 * Start), so every normal Lovable deployment updates the iOS app with no
 * native rebuild. `native-www/` is only an offline fallback page.
 *
 * Navigation: only hosts listed in `allowNavigation` stay inside the app;
 * any other link opens in Safari (Capacitor default).
 */
const config: CapacitorConfig = {
  appId: "com.ourfamilycalendar.app",
  appName: "Our Family Calendar",
  webDir: "native-www",
  server: {
    url: "https://ourfamilycalendar.com",
    allowNavigation: ["ourfamilycalendar.com", "www.ourfamilycalendar.com", "our-fam-cal.lovable.app"],
    errorPath: "index.html",
  },
  ios: {
    // Web layout handles safe areas via env(safe-area-inset-*) + viewport-fit=cover.
    contentInset: "never",
    backgroundColor: "#FAF8F4",
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
