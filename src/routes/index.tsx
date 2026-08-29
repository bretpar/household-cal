import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays, Palette, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";

import logoAsset from "@/assets/logo.png.asset.json";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/LegalFooter";
import { getSessionStatus, hasCachedSession, peekSessionStatus } from "@/lib/session-hint";

const LOGO_IMAGE_URL =
  "https://ourfamilycalendar.com/__l5e/assets-v1/1cbc3ae6-235d-438e-9bff-3eace728929e/logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Family Calendar — one shared plan for your household" },
      {
        name: "description",
        content:
          "A warm shared household calendar: school, activities, work and caregiver coverage, with per-person colors and simple permissions.",
      },
      { property: "og:title", content: "Family Calendar — one shared plan for your household" },
      {
        property: "og:description",
        content:
          "See what everyone in your household is doing, filter by person, and share access with a caregiver.",
      },
      { property: "og:image", content: LOGO_IMAGE_URL },
      { name: "twitter:image", content: LOGO_IMAGE_URL },
    ],
  }),
  component: LandingPage,
});

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Month, week and today views",
    body: "Long school and work commitments stay compact so the day's real plans stand out.",
  },
  {
    icon: Users,
    title: "Everyone in one place",
    body: "Add your own household members, with their own initials and colors.",
  },
  {
    icon: Palette,
    title: "Caregiver coverage",
    body: "Childcare shows up as gentle background shading, never as another event to read.",
  },
  {
    icon: ShieldCheck,
    title: "Private per household",
    body: "Each household's calendar is only visible to the people invited to it.",
  },
];

function AuthLoadingShell() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-soft border-t-primary" />
    </div>
  );
}

function LandingPage() {
  const navigate = useNavigate();
  // Start in "checking" whenever a persisted session might exist, so the
  // landing page never paints for an already-signed-in user.
  const [checking, setChecking] = useState(
    () => peekSessionStatus() !== false || hasCachedSession(),
  );

  useEffect(() => {
    let active = true;
    getSessionStatus().then((signedIn) => {
      if (!active) return;
      if (signedIn) navigate({ to: "/today", replace: true });
      else setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (checking) return <AuthLoadingShell />;



  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 lg:px-8">
        <div className="flex items-center gap-3">
          <img
            src={logoAsset.url}
            alt="Our Family Calendar logo"
            className="h-10 w-10 rounded-xl object-contain"
          />
          <span className="font-display text-lg font-bold">Our Family Calendar</span>
        </div>
        <Link to="/auth">
          <Button variant="ghost" className="h-10 rounded-full px-4 font-bold">
            Sign in
          </Button>
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 lg:px-8">
        <section className="rounded-4xl border border-border-soft bg-card p-6 shadow-soft sm:p-10">
          <h1 className="font-display text-3xl leading-tight font-bold sm:text-5xl">
            One shared calendar for your whole household
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            School, activities, work and childcare in one friendly place. Invite a partner or a caregiver to start sharing your calendars today!
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/auth">
              <Button size="lg" className="h-12 rounded-full px-6 font-bold">
                {checking ? "Get started" : "Get started"}
              </Button>
            </Link>
          </div>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-3xl border border-border-soft bg-surface p-5 shadow-soft"
            >
              <Icon className="h-5 w-5 text-primary" aria-hidden />
              <h2 className="mt-3 text-base font-bold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </article>
          ))}
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}
