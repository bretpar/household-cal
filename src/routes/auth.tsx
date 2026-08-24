import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, validatePassword } from "@/lib/password";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const value = search["redirect"];
    return typeof value === "string" && value.startsWith("/") ? { redirect: value } : {};
  },
  head: () => ({
    meta: [
      { title: "Sign in — Family Calendar" },
      {
        name: "description",
        content: "Sign in to your household calendar with email or Google.",
      },
      { property: "og:title", content: "Sign in — Family Calendar" },
      { property: "og:description", content: "Access your household's shared calendar." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const goHome = () => {
    if (redirect) window.location.assign(redirect);
    else navigate({ to: "/today", replace: true });
  };
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goHome();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        goHome();
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, redirect]);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast.error("Enter your email and password");
      return;
    }
    if (mode === "signup") {
      const problem = validatePassword(password);
      if (problem) {
        toast.error(problem);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (!data.session) {
          // No email confirmation step: sign straight in so onboarding continues.
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (signInError) throw signInError;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: redirect
        ? `${window.location.origin}/auth?redirect=${encodeURIComponent(redirect)}`
        : window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      return;
    }
    if (result.redirected) return;
    goHome();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border-soft bg-card p-6 shadow-soft">
        <h1 className="font-display text-2xl font-bold">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to see your household calendar."
            : "Sign up and your household will be set up for you."}
        </p>

        <div className="mt-5 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <Button
            className="h-11 w-full rounded-full font-bold"
            onClick={submit}
            disabled={busy}
            type="button"
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </div>

        <div className="my-4 flex items-center gap-3 text-xs font-semibold text-muted-foreground">
          <span className="h-px flex-1 bg-border-soft" />
          or
          <span className="h-px flex-1 bg-border-soft" />
        </div>

        <Button
          variant="outline"
          className="h-11 w-full rounded-full font-bold"
          onClick={googleSignIn}
          type="button"
        >
          Continue with Google
        </Button>

        <button
          type="button"
          className="mt-5 w-full text-sm font-semibold text-muted-foreground hover:text-foreground"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
