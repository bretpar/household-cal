import { Info } from "lucide-react";

import { isNativeApp } from "@/lib/native-auth";

/**
 * Internal build marker for the native iPhone stale-resume investigation.
 * Read-only, no secrets: which deployed bundle this WebView is executing,
 * the app version, when this page was loaded, and whether we are inside the
 * Capacitor shell. Rendered only inside the locked Maintenance section.
 *
 * `LOADED_AT` is captured at module evaluation, so a stale resumed WebView
 * keeps the timestamp of the page load that is actually running.
 */
const LOADED_AT = new Date();

export function BuildDiagnostics() {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
        <Info className="h-4 w-4" aria-hidden />
        Build diagnostics
      </h2>
      <dl className="space-y-1.5 rounded-3xl border border-dashed border-border bg-card p-4 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Build (deployed at · revision)</dt>
          <dd className="font-mono text-xs">{__OFC_BUILD_ID__}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">App version</dt>
          <dd className="font-mono text-xs">{__OFC_APP_VERSION__}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Page loaded at</dt>
          <dd className="font-mono text-xs">{LOADED_AT.toISOString()}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Native shell</dt>
          <dd className="font-mono text-xs">{isNativeApp() ? "yes (Capacitor)" : "no (browser)"}</dd>
        </div>
      </dl>
    </section>
  );
}
