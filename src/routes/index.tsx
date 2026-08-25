import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays, Palette, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/LegalFooter";
import { supabase } from "@/integrations/supabase/client";

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

function LandingPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/today", replace: true });
      else setChecking(false);
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 lg:px-8">
        <span className="font-display text-lg font-bold">Family Calendar</span>
        <Link to="/auth">
          <Button variant="ghost" className="h-10 rounded-full px-4 font-bold">
            Sign in
          </Button>
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 lg:px-8">
        <section className="rounded-4xl border border-border-soft bg-card p-6 shadow-soft sm:p-10">
          <h1 className="font-display text-3xl leading-tight font-bold sm:text-5xl">
            One warm, shared calendar for your whole household
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            School, activities, work and childcare in one friendly place. Invite a partner or a
            caregiver and decide exactly what they can change.
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
