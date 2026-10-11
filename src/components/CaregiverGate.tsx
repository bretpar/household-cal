import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AppShell, PageContentSkeleton } from "@/components/AppShell";
import { useCaregiver } from "@/lib/use-caregiver";

/**
 * Content-only pending/error state: keeps the shared header and tabs visible
 * (it declares the shell) and never renders the guarded page early.
 */
function GatePending({ failed, retry }: { failed: boolean; retry: () => void }) {
  return (
    <AppShell>
      {failed ? (
        <div className="mx-auto max-w-sm space-y-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">We couldn't confirm your access.</p>
          <button
            type="button"
            onClick={retry}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
        </div>
      ) : (
        <PageContentSkeleton />
      )}
    </AppShell>
  );
}

/** Parent-only pages: caregivers are redirected before any parent UI renders. */
export function ParentOnly({ children }: { children: ReactNode }) {
  const { isCaregiver, resolved, failed, retry } = useCaregiver();
  if (!resolved) return <GatePending failed={failed} retry={retry} />;
  if (isCaregiver) return <Navigate to="/today" replace />;
  return <>{children}</>;
}

/** Caregiver-only pages: everyone else goes back to their normal page. */
export function CaregiverOnly({ children, fallback }: { children: ReactNode; fallback: "/today" | "/family" }) {
  const { isCaregiver, resolved, failed, retry } = useCaregiver();
  if (!resolved) return <GatePending failed={failed} retry={retry} />;
  if (!isCaregiver) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}
