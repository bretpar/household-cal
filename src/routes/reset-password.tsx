import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, validatePassword } from "@/lib/password";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — Family Calendar" },
      {
        name: "description",
        content: "Choose a new password for your household calendar account.",
      },
      { property: "og:title", content: "Reset password — Family Calendar" },
      { property: "og:description", content: "Set a new password for your family calendar." },
    ],
  }),
  component: ResetPasswordPage,
});

type Status = "checking" | "ready" | "invalid" | "done";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        settled = true;
        setStatus((prev) => (prev === "done" ? prev : "ready"));
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setStatus((prev) => (prev === "done" ? prev : "ready"));
        return;
      }
      // Give the client a moment to process the recovery link in the URL.
      setTimeout(() => {
        if (!settled) setStatus((prev) => (prev === "checking" ? "invalid" : prev));
      }, 1500);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async () => {
    const problem = validatePassword(password);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
      toast.success("Password updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border-soft bg-card p-6 shadow-soft">
        {status === "checking" ? (
          <p className="text-sm text-muted-foreground">Checking your reset link…</p>
        ) : null}

        {status === "invalid" ? (
          <>
            <h1 className="font-display text-2xl font-bold">Link expired</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This password reset link is invalid or has expired. Request a new one from the sign-in
              screen.
            </p>
            <Button
              className="mt-5 h-11 w-full rounded-full font-bold"
              onClick={() => navigate({ to: "/auth", replace: true })}
              type="button"
            >
              Back to sign in
            </Button>
          </>
        ) : null}

        {status === "done" ? (
          <>
            <h1 className="font-display text-2xl font-bold">Password updated</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You're all set. Continue to your household calendar.
            </p>
            <Button
              className="mt-5 h-11 w-full rounded-full font-bold"
              onClick={() => navigate({ to: "/today", replace: true })}
              type="button"
            >
              Go to calendar
            </Button>
          </>
        ) : null}

        {status === "ready" ? (
          <>
            <h1 className="font-display text-2xl font-bold">Choose a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">{PASSWORD_HINT}</p>
            <div className="mt-5 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <Button
                className="h-11 w-full rounded-full font-bold"
                onClick={submit}
                disabled={busy}
                type="button"
              >
                Update password
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
