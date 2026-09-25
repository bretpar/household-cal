import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/native-auth";
import { setSessionStatus } from "@/lib/session-hint";

/**
 * Single sign-out control for the app (Settings). Signs out only this
 * device/session — other devices stay signed in — and never reports success
 * when the sign-out failed.
 *
 * Deliberately independent of the Safari Google sign-in handoff: that flow has
 * its own session handling in /native-google-auth and is untouched here.
 */
export function SignOutButton() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await queryClient.cancelQueries();
      // scope "local": current device only.
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;

      queryClient.clear();
      setSessionStatus(false);
      // Belt and braces: no stale persisted token can silently re-authenticate.
      try {
        for (const key of Object.keys(localStorage)) {
          if (/^sb-.*-auth-token/.test(key)) localStorage.removeItem(key);
        }
      } catch {
        // Storage unavailable (private mode / brokered preview storage).
      }

      // Native shell: back to the welcome screen. Web: the login page.
      navigate({ to: isNativeApp() ? "/" : "/auth", replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? `Couldn't sign out: ${error.message}`
          : "Couldn't sign out. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="destructive"
      onClick={signOut}
      disabled={busy}
      className="h-12 w-full rounded-full text-base font-bold"
    >
      <LogOut className="h-5 w-5" aria-hidden />
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
