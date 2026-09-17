// Lightweight Google Analytics (gtag.js) wiring.
// No-ops until a Google Analytics measurement ID is connected to the project
// (VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY), so the site works
// identically with or without analytics configured.

const measurementId = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY"] as
  | string
  | undefined;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let initialized = false;

export function initAnalytics(): void {
  if (initialized || typeof window === "undefined" || !measurementId) return;
  initialized = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId);
}

export function trackEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !measurementId || !window.gtag) return;
  window.gtag("event", eventName, params);
}
