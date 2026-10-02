import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { StartupSplash } from "@/components/StartupSplash";
import { useCaregiver } from "@/lib/use-caregiver";

/** Parent-only pages: caregivers are redirected before any parent UI renders. */
export function ParentOnly({ children }: { children: ReactNode }) {
  const { isCaregiver, resolved } = useCaregiver();
  if (!resolved) return <StartupSplash />;
  if (isCaregiver) return <Navigate to="/today" replace />;
  return <>{children}</>;
}

/** Caregiver-only pages: everyone else goes back to their normal page. */
export function CaregiverOnly({ children, fallback }: { children: ReactNode; fallback: "/today" | "/family" }) {
  const { isCaregiver, resolved } = useCaregiver();
  if (!resolved) return <StartupSplash />;
  if (!isCaregiver) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}
