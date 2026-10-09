import { StartupSplash } from "@/components/StartupSplash";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Baby,
  Bot,
  CalendarDays,
  CalendarSync,
  Check,
  Clock3,
  LayoutGrid,
  Mail,
  Minus,
  Palette,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import logoAsset from "@/assets/logo.png.asset.json";
import heroMonthAsset from "@/assets/landing-hero-month-desktop.png.asset.json";
import mobileDayAsset from "@/assets/landing-mobile-day.png.asset.json";
import ogImageAsset from "@/assets/landing-og-image.png.asset.json";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/LegalFooter";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { getSessionStatus, hasCachedSession, peekSessionStatus } from "@/lib/session-hint";

const SITE_URL = "https://ourfamilycalendar.com";
const OG_IMAGE_URL = `${SITE_URL}${ogImageAsset.url}`;

const FAQ_ITEMS = [
  {
    question: "What is a shared family calendar?",
    answer:
      "A shared family calendar is one calendar your whole household can see. School, sports, work, appointments and childcare all live in one place, so everyone knows what is happening next without texting each other to ask.",
  },
  {
    question: "Can I sync Our Family Calendar with Google Calendar?",
    answer:
      "Yes. You can connect Google Calendar so the events your family already relies on show up in Our Family Calendar — no rebuilding your schedule from scratch.",
  },
  {
    question: "Can I share the calendar with a babysitter or nanny?",
    answer:
      "Yes. You can invite babysitters, nannies, grandparents and other caregivers, and control who can make changes. Caregiver coverage appears right inside the family schedule.",
  },
  {
    question: "Can different family members have different colors?",
    answer:
      "Yes. Every family member gets their own color and initials, so you can tell who an activity belongs to at a glance without opening the event.",
  },
  {
    question: "Can I use Our Family Calendar on my phone?",
    answer:
      "Yes. Our Family Calendar works on phones, tablets and computers — there is no special hardware to buy or install.",
  },
  {
    question: "Does everyone in my family need an account?",
    answer:
      "No. You can add family members to your household without an account — including kids — and they still get their own color and place on the schedule. Adults and caregivers you invite can sign in to see the calendar themselves.",
  },
  {
    question: "Is my family calendar private?",
    answer:
      "Yes. Each household's calendar is only visible to the people you invite to it.",
  },
  {
    question: "Can I connect ChatGPT or Claude to my family calendar?",
    answer:
      "Yes. If you use a compatible AI assistant, you can connect it to your Our Family Calendar account to ask about upcoming events and schedules. It is read-only, and it can only see what that signed-in household member can already see in the app.",
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Our Family Calendar | Shared Family Calendar & Scheduling App" },
      {
        name: "description",
        content:
          "Organize your family’s schedules, kids’ activities, and babysitter shifts in one shared calendar. Sync with Google Calendar and simplify family planning.",
      },
      { property: "og:title", content: "Our Family Calendar | Shared Family Calendar & Scheduling App" },
      {
        property: "og:description",
        content:
          "Organize your family’s schedules, kids’ activities, and babysitter shifts in one shared calendar. Sync with Google Calendar and simplify family planning.",
      },
      { property: "og:url", content: `${SITE_URL}/` },
      { property: "og:image", content: OG_IMAGE_URL },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE_URL },
      { name: "robots", content: "index, follow" },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ_ITEMS.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: { "@type": "Answer", text: item.answer },
          })),
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              name: "Our Family Calendar",
              url: `${SITE_URL}/`,
            },
            {
              "@type": "Organization",
              name: "Our Family Calendar",
              url: `${SITE_URL}/`,
              logo: `${SITE_URL}/launch-logo.png`,
            },
            {
              "@type": "SoftwareApplication",
              name: "Our Family Calendar",
              applicationCategory: "ProductivityApplication",
              operatingSystem: "Web",
              url: `${SITE_URL}/`,
              description:
                "A shared family calendar for activities, childcare scheduling and caregiver timesheets, on phone, tablet and computer.",
            },
          ],
        }),
      },
    ],
  }),
  component: LandingPage,
});

const GLANCE_FEATURES = [
  {
    icon: Palette,
    title: "Everyone has their own color",
    body: "Know who an activity belongs to without opening every event.",
  },
  {
    icon: Baby,
    title: "Childcare stays visible",
    body: "See babysitter or caregiver coverage alongside the rest of the family schedule.",
  },
  {
    icon: LayoutGrid,
    title: "Day, Week & Month views",
    body: "Zoom into today or see the entire family schedule.",
  },
  {
    icon: CalendarSync,
    title: "Google Calendar stays connected",
    body: "Keep using the calendars you already rely on.",
  },
];

const MOBILE_POINTS = [
  "Clear times and activities",
  "Family-member colors and initials",
  "Babysitter and caregiver coverage built into the schedule",
];

const STEPS = [
  {
    title: "Create your household",
    body: "Add parents, kids and anyone whose schedule matters.",
  },
  {
    title: "Connect your calendar",
    body: "Bring in Google Calendar events instead of rebuilding your schedule.",
  },
  {
    title: "Invite your family and caregivers",
    body: "Give each person the access they need.",
  },
  {
    title: "Everyone knows what's next",
    body: "Check the schedule from a phone or computer.",
  },
];

type CompareValue = { kind: "yes" | "no" } | { kind: "text"; label: string };

const COMPARISON_ROWS: { label: string; ours: CompareValue; organizer: CompareValue; wall: CompareValue }[] = [
  { label: "Shared family schedule", ours: { kind: "yes" }, organizer: { kind: "yes" }, wall: { kind: "yes" } },
  {
    label: "Works on phones & computers",
    ours: { kind: "yes" },
    organizer: { kind: "text", label: "Usually" },
    wall: { kind: "text", label: "Varies" },
  },
  {
    label: "Google Calendar integration",
    ours: { kind: "yes" },
    organizer: { kind: "text", label: "Varies" },
    wall: { kind: "text", label: "Often" },
  },
  {
    label: "Individual family colors",
    ours: { kind: "yes" },
    organizer: { kind: "text", label: "Often" },
    wall: { kind: "text", label: "Often" },
  },
  {
    label: "Caregiver access",
    ours: { kind: "yes" },
    organizer: { kind: "text", label: "Varies" },
    wall: { kind: "text", label: "Varies" },
  },
  {
    label: "Childcare visible in the family schedule",
    ours: { kind: "yes" },
    organizer: { kind: "text", label: "Varies" },
    wall: { kind: "text", label: "Varies" },
  },
  {
    label: "Special hardware required",
    ours: { kind: "no" },
    organizer: { kind: "no" },
    wall: { kind: "yes" },
  },
  {
    label: "Calendar-first experience",
    ours: { kind: "yes" },
    organizer: { kind: "text", label: "Often mixed with other features" },
    wall: { kind: "yes" },
  },
];

const COMPARISON_COLUMNS: { key: "ours" | "organizer" | "wall"; label: string }[] = [
  { key: "ours", label: "Our Family Calendar" },
  { key: "organizer", label: "Typical family organizer" },
  { key: "wall", label: "Wall calendar device" },
];

function CompareMark({ value }: { value: CompareValue }) {
  if (value.kind === "yes") {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-success">
        <Check className="h-4 w-4" aria-hidden /> Yes
      </span>
    );
  }
  if (value.kind === "text") return <span className="text-muted-foreground">{value.label}</span>;
  if (value.kind === "no") {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground">
        <Minus className="h-4 w-4" aria-hidden /> No
      </span>
    );
  }
  return null;
}

function AuthLoadingShell() {
  return <StartupSplash />;
}

function LandingPage() {
  const navigate = useNavigate();
  // The landing copy has to be in the HTML a crawler receives, so the page
  // always renders it. A visitor who is already signed in gets the opaque splash
  // overlay on top until the session check sends them to their calendar.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    initAnalytics();
    // No stored session: skip the loader and show the page straight away
    // (the server can't read storage, so it always renders the loader first).
    if (!hasCachedSession() && peekSessionStatus() !== true) setChecking(false);
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

  return (
    <div className="min-h-screen bg-background">
      {checking ? <AuthLoadingShell /> : null}
      <header className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:flex sm:justify-between sm:px-6 sm:py-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src={logoAsset.url}
            alt="Our Family Calendar logo"
            className="h-9 w-9 shrink-0 rounded-xl object-contain sm:h-10 sm:w-10"
          />
          <span className="truncate font-display text-base font-bold sm:text-lg">
            Our Family Calendar
          </span>
        </div>
        <nav className="flex shrink-0 items-center gap-1.5 sm:gap-2" aria-label="Account">
          <Link to="/auth" search={{ mode: "signup" }}>
            <Button
              variant="ghost"
              className="h-10 rounded-full px-3 font-bold sm:px-4"
              onClick={() => trackEvent("sign_in_click", { location: "header" })}
            >
              Sign in
            </Button>
          </Link>
          <Link to="/auth" search={{ mode: "signup" }} className="hidden sm:inline-flex">
            <Button className="h-10 rounded-full px-5 font-bold">Get started</Button>
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-14 pt-4 sm:px-6 sm:pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10 lg:px-8 lg:pb-20">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-widest text-primary uppercase">
              Family scheduling, simplified
            </p>
            <h1 className="mt-3 font-display text-4xl leading-tight font-bold sm:text-5xl">
              The shared family calendar that keeps everyone on the same page.
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
              School. Sports. Work. Childcare. Appointments. One simple calendar everyone can
              understand.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link to="/auth" search={{ mode: "signup" }}>
                <Button
                  size="lg"
                  className="h-12 rounded-full px-6 font-bold"
                  onClick={() => trackEvent("start_family_calendar_click", { location: "hero" })}
                >
                  Start your family calendar
                </Button>
              </Link>
              <Link to="/auth" search={{ mode: "signup" }}>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 rounded-full px-6 font-bold"
                  onClick={() => trackEvent("sign_in_click", { location: "hero" })}
                >
                  Sign in
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Works with Google Calendar · Invite caregivers · No special hardware required
            </p>
          </div>
          <figure className="min-w-0 overflow-hidden rounded-3xl border border-border-soft bg-card shadow-lifted">
            <img
              src={heroMonthAsset.url}
              alt="Our Family Calendar desktop Month view showing a shared family schedule with color-coded events for each family member"
              className="block h-auto w-full"
              loading="eager"
            />
          </figure>
        </section>

        {/* Problem / value */}
        <section className="border-y border-border-soft bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20 lg:px-8">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Family life gets complicated fast.
            </h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              School, sports, appointments, work schedules, childcare and last-minute changes end up
              spread across texts, calendars and conversations.
            </p>
            <p className="mt-8 font-display text-xl font-bold text-primary sm:text-2xl">
              "Everyone shouldn't need another text message to know what's happening."
            </p>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              Our Family Calendar gives your household one shared place to see what's next.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              See how the{" "}
              <Link to="/features/family-calendar" className="font-semibold text-primary underline underline-offset-4">shared family calendar</Link>{" "}
              works, or{" "}
              <Link to="/best-shared-calendar-app" className="font-semibold text-primary underline underline-offset-4">compare shared calendar apps</Link>.
            </p>
          </div>
        </section>

        {/* See your family at a glance */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              See your family at a glance
            </h2>
          </div>
          <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {GLANCE_FEATURES.map(({ icon: Icon, title, body }) => (
              <article
                key={title}
                className="rounded-3xl border border-border-soft bg-card p-6 shadow-soft sm:p-7"
              >
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent">
                  <Icon className="h-5 w-5 text-accent-foreground" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
          <article className="mt-4 rounded-3xl border border-border-soft bg-card p-6 shadow-soft sm:mt-6 sm:p-7">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent">
              <Bot className="h-5 w-5 text-accent-foreground" aria-hidden />
            </div>
            <h3 className="mt-4 text-lg font-bold">
              AI assistant access{" "}
              <span className="ml-1 rounded-full bg-surface-muted px-2.5 py-0.5 align-middle text-xs font-bold text-muted-foreground">
                Bonus
              </span>
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Ask ChatGPT or Claude about upcoming family events, with read-only access.
            </p>
          </article>
        </section>

        {/* Childcare & caregiver timesheets (SEO differentiator) */}
        <section
          id="childcare"
          className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8"
        >
          <article className="rounded-3xl border border-border-soft bg-card p-6 shadow-soft sm:p-10">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent">
              <Baby className="h-5 w-5 text-accent-foreground" aria-hidden />
            </div>
            <h2 className="mt-4 font-display text-3xl font-bold sm:text-4xl">
              Childcare built into your family calendar
            </h2>
            <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Schedule babysitters and nannies alongside your family activities, share only the
              schedule they need, and keep track of caregiver hours with built-in timesheets.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {["Babysitter scheduling", "Caregiver access", "Nanny timesheets", "Weekly schedules"].map(
                (item) => (
                  <li
                    key={item}
                    className="rounded-full border border-border-soft bg-surface-muted px-3 py-1 text-xs font-bold text-muted-foreground"
                  >
                    {item}
                  </li>
                ),
              )}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/features/childcare-scheduling"
                className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-input bg-card px-4 text-[13px] font-bold text-primary hover:bg-accent sm:h-11 sm:w-auto sm:px-5 sm:text-sm"
              >
                Explore babysitter &amp; nanny scheduling
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </article>
        </section>

        {/* Mobile showcase */}
        <section className="border-y border-border-soft bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-12 lg:px-8">
            <div className="order-2 min-w-0 lg:order-1">
              <div className="mx-auto w-fit rounded-[2.5rem] border border-border-soft bg-card p-2.5 shadow-lifted">
                <img
                  src={mobileDayAsset.url}
                  alt="Our Family Calendar mobile Day view showing activities with times, family-member badges, and babysitter coverage"
                  className="block h-auto w-64 rounded-[2rem] sm:w-72 lg:w-80"
                  loading="lazy"
                />
              </div>
            </div>
            <div className="order-1 min-w-0 lg:order-2">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">
                Know what's happening today.
              </h2>
              <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                See activities, times, family members and childcare coverage in one clear daily view
                — wherever you are.
              </p>
              <ul className="mt-6 space-y-3">
                {MOBILE_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success-soft">
                      <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                    </span>
                    <span className="text-sm font-semibold sm:text-base">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Caregiver differentiation */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
            <div className="min-w-0">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">
                Built for more than just Mom and Dad.
              </h2>
              <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                Grandparents, babysitters, nannies and other caregivers often need to know what's
                happening without needing full control of your household.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: UserPlus, label: "Invite caregivers" },
                { icon: ShieldCheck, label: "Keep your household private" },
                { icon: Users, label: "Control who can make changes" },
                { icon: Clock3, label: "Give everyone the schedule information they need" },
              ].map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-start gap-3 rounded-2xl border border-border-soft bg-card p-4 shadow-soft"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent">
                    <Icon className="h-4 w-4 text-accent-foreground" aria-hidden />
                  </span>
                  <span className="pt-1.5 text-sm font-semibold">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-border-soft bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Set up your family in minutes
            </h2>
            <ol className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="rounded-3xl border border-border-soft bg-card p-6 shadow-soft"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-primary font-display text-base font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-base font-bold">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Comparison */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Built for families who just want the calendar to work
            </h2>
          </div>

          {/* Desktop/tablet table */}
          <div className="mt-8 hidden overflow-hidden rounded-3xl border border-border-soft bg-card shadow-soft sm:mt-10 sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-soft">
                  <th scope="col" className="p-4 font-semibold text-muted-foreground">
                    <span className="sr-only">Feature</span>
                  </th>
                  {COMPARISON_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={
                        column.key === "ours"
                          ? "bg-accent p-4 font-display text-base font-bold text-accent-foreground"
                          : "p-4 font-semibold text-muted-foreground"
                      }
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="border-t border-border-soft first:border-t-0">
                    <th scope="row" className="p-4 font-semibold">
                      {row.label}
                    </th>
                    <td className="bg-accent/60 p-4">
                      <CompareMark value={row.ours} />
                    </td>
                    <td className="p-4">
                      <CompareMark value={row.organizer} />
                    </td>
                    <td className="p-4">
                      <CompareMark value={row.wall} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked comparison */}
          <div className="mt-8 space-y-4 sm:hidden">
            {COMPARISON_ROWS.map((row) => (
              <article
                key={row.label}
                className="rounded-3xl border border-border-soft bg-card p-5 shadow-soft"
              >
                <h3 className="text-sm font-bold">{row.label}</h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-accent px-3 py-2">
                    <dt className="font-bold text-accent-foreground">Our Family Calendar</dt>
                    <dd>
                      <CompareMark value={row.ours} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <dt className="text-muted-foreground">Typical organizer</dt>
                    <dd>
                      <CompareMark value={row.organizer} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <dt className="text-muted-foreground">Wall calendar device</dt>
                    <dd>
                      <CompareMark value={row.wall} />
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <p className="mx-auto mt-8 max-w-3xl text-center text-base text-muted-foreground sm:mt-10 sm:text-lg">
            No meal planner. No recipe collection. No chore economy. No new screen for your kitchen.
            Just a family calendar designed to make a complicated week easier to understand.
          </p>
        </section>

        {/* Email summaries */}
        <section className="border-y border-border-soft bg-surface">
          <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-14 text-center sm:px-6 sm:py-20 lg:px-8">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent shadow-soft">
              <Mail className="h-6 w-6 text-accent-foreground" aria-hidden />
            </span>
            <h2 className="mt-6 font-display text-3xl font-bold sm:text-4xl">
              Your calendar can come to you.
            </h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              Daily, weekly and monthly family summaries help everyone see what's ahead without
              constantly checking another app.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Questions, answered</h2>
          <div className="mt-8 space-y-3">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.question}
                className="group rounded-2xl border border-border-soft bg-card px-5 py-4 shadow-soft"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ArrowRight
                    className="h-4 w-4 shrink-0 rotate-90 text-muted-foreground transition-transform group-open:-rotate-90"
                    aria-hidden
                  />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-4xl border border-border-soft bg-primary px-6 py-12 text-center shadow-lifted sm:px-10 sm:py-16">
            <CalendarDays className="mx-auto h-8 w-8 text-primary-foreground/80" aria-hidden />
            <h2 className="mt-4 font-display text-3xl font-bold text-primary-foreground sm:text-4xl">
              Less coordinating. More knowing.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-base text-primary-foreground/85 sm:text-lg">
              One shared place for school, activities, appointments, work and childcare.
            </p>
            <div className="mt-7">
              <Link to="/auth" search={{ mode: "signup" }}>
                <Button
                  size="lg"
                  variant="secondary"
                  className="h-12 rounded-full bg-primary-foreground px-7 font-bold text-primary hover:bg-primary-foreground/90"
                >
                  Create your family calendar
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-primary-foreground/75">
              Get started in minutes. Invite your family when you're ready.
            </p>
          </div>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}
