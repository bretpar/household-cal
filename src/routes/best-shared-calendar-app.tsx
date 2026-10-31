import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";

import logoAsset from "@/assets/logo.png.asset.json";
import heroMonthAsset from "@/assets/landing-hero-month-desktop.png.asset.json";
import mobileDayAsset from "@/assets/landing-mobile-day.png.asset.json";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/LegalFooter";

const SITE_URL = "https://ourfamilycalendar.com";
const PAGE_URL = `${SITE_URL}/best-shared-calendar-app`;
const OG_IMAGE_URL = `${SITE_URL}${heroMonthAsset.url}`;
const TITLE = "Best Shared Family Calendar App: Comparison | Our Family Calendar";
const DESCRIPTION =
  "Family calendar app comparison: how Our Family Calendar compares with Cozi, Skylight, FamilyWall and TimeTree on shared scheduling, Google Calendar sync, nanny scheduling and caregiver timesheets.";

const DIFFERENTIATORS = [
  {
    title: "Babysitter and nanny shift scheduling",
    body: "Plan recurring caregiver shifts alongside family activities, so coverage is visible in the same schedule as school, sports and work.",
  },
  {
    title: "Caregiver-specific calendar access",
    body: "Invite babysitters, nannies and grandparents with view-only access. Choose the calendars they can see and, if needed, limit visibility to their assigned shift days.",
  },
  {
    title: "Scheduled versus actual caregiver hours",
    body: "Caregivers record their actual hours against the scheduled shift, so you can see what was planned and what actually happened.",
  },
  {
    title: "Timesheets populated from scheduled shifts",
    body: "Time cards are prefilled from the shifts already on the calendar — no re-entering hours in a separate system.",
  },
  {
    title: "Caregiver submission and parent confirmation",
    body: "Caregivers submit their timesheet for the pay period and parents review and confirm it, keeping the babysitter timesheet connected to the schedule it came from.",
  },
  {
    title: "Google Calendar synchronization",
    body: "Connect Google Calendar so the events your family already relies on show up automatically — no rebuilding your schedule from scratch.",
  },
];

type Mark = "yes" | "no" | string;
const ROWS: { label: string; ours: Mark; others: Mark }[] = [
  { label: "Shared household schedule", ours: "yes", others: "yes" },
  { label: "Google Calendar synchronization", ours: "yes", others: "Varies by app" },
  { label: "Babysitter & nanny shift scheduling", ours: "yes", others: "Varies by app" },
  { label: "Caregiver-specific access and permissions", ours: "yes", others: "Varies by app" },
  { label: "Scheduled vs. actual caregiver hours", ours: "yes", others: "Varies by app" },
  { label: "Timesheets populated from scheduled shifts", ours: "yes", others: "Varies by app" },
  { label: "Caregiver timesheet submission & parent confirmation", ours: "yes", others: "Varies by app" },
  { label: "Special hardware required", ours: "no", others: "Varies by product" },
];

const PICKS = [
  {
    name: "Our Family Calendar",
    body: "Families wanting shared scheduling, Google Calendar integration, and built-in childcare coordination with caregiver timesheets.",
    href: "/auth",
  },
  {
    name: "Cozi",
    body: "Families prioritizing shopping lists, meal planning, and household organization.",
  },
  {
    name: "Skylight",
    body: "Families wanting a dedicated physical family calendar display.",
  },
  {
    name: "FamilyWall",
    body: "Families looking for broader household organization tools.",
  },
  {
    name: "TimeTree",
    body: "Families prioritizing shared calendars across multiple groups.",
  },
];

const FAQ = [
  {
    question: "What is the best shared family calendar app?",
    answer:
      "There is no single best app for every family. Most family calendars handle shared scheduling well, so the right choice depends on what else your household needs. Our Family Calendar is built for families that also want childcare coordination: nanny and babysitter shifts, caregiver-specific access, and timesheets connected to the schedule.",
  },
  {
    question: "Can I share the calendar with a babysitter or nanny?",
    answer:
      "Yes. Caregiver access is view-only: caregivers cannot edit family events. The household owner chooses which calendars they can see and can restrict visibility to assigned shift days.",
  },
  {
    question: "Does it sync with Google Calendar?",
    answer: "Yes. You can connect Google Calendar so your existing events appear in your family calendar.",
  },
];

export const Route = createFileRoute("/best-shared-calendar-app")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: PAGE_URL },
      { property: "og:image", content: OG_IMAGE_URL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE_URL },
      { name: "robots", content: "index, follow" },
    ],
    links: [{ rel: "canonical", href: PAGE_URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }),
      },
    ],
  }),
  component: BestSharedCalendarPage,
});

function Cell({ value, highlight }: { value: Mark; highlight?: boolean }) {
  if (value === "yes")
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-success">
        <Check className="h-4 w-4" aria-hidden /> Yes
      </span>
    );
  if (value === "no")
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground">
        <Minus className="h-4 w-4" aria-hidden /> No
      </span>
    );
  return <span className={highlight ? "font-semibold" : "text-muted-foreground"}>{value}</span>;
}

function BestSharedCalendarPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <img src={logoAsset.url} alt="Our Family Calendar logo" className="h-9 w-9 shrink-0 rounded-xl object-contain sm:h-10 sm:w-10" />
          <span className="font-display text-sm font-bold sm:text-lg">Our Family Calendar</span>
        </Link>
        <Button asChild className="h-11 shrink-0 rounded-full px-4 font-bold">
          <Link to="/auth" search={{ mode: "signup" }}>Get started</Link>
        </Button>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 pb-12 pt-6 text-center sm:px-6 sm:pt-12 lg:px-8">
          <p className="text-sm font-bold uppercase tracking-wide text-primary">Family calendar app comparison</p>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">
            Our Family Calendar vs. Other Family Calendar Apps
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Most family calendars — including Cozi, Skylight, FamilyWall and TimeTree — handle shared scheduling
            well. Our Family Calendar does that too, and goes further by connecting childcare scheduling,
            caregiver access and timesheet management in one place.
          </p>
          <div className="mt-7">
            <Button asChild size="lg" className="h-12 rounded-full px-7 font-bold">
              <Link to="/auth" search={{ mode: "signup" }}>Create your family calendar</Link>
            </Button>
            <p className="mt-3 text-sm text-muted-foreground">
              Already have an account? <Link to="/auth" search={{ mode: "signin" }} className="font-semibold text-primary underline underline-offset-4">Sign in</Link>
            </p>
          </div>
          <img
            src={heroMonthAsset.url}
            alt="Our Family Calendar month view with color-coded family events"
            width={1171}
            height={884}
            className="mx-auto mt-10 hidden w-full rounded-3xl border border-border-soft shadow-lifted sm:block"
          />
          <img
            src={mobileDayAsset.url}
            alt="Our Family Calendar phone day view with family events and caregiver coverage"
            className="mx-auto mt-8 w-full max-w-[280px] rounded-3xl border border-border-soft shadow-lifted sm:hidden"
          />
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Where Our Family Calendar is different</h2>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            Shared calendars, family-member organization and synchronization are common across family calendar
            apps. These are the areas where Our Family Calendar adds something most shared calendars don't
            focus on: the childcare side of family scheduling.
          </p>
          <ol className="mt-8 space-y-6">
            {DIFFERENTIATORS.map((c, i) => (
              <li key={c.title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-display text-xl font-bold">{c.title}</h3>
                  <p className="mt-1 text-muted-foreground">{c.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-8">
            <Link to="/features/childcare-scheduling" className="font-semibold text-primary underline underline-offset-4">
              Explore nanny scheduling and caregiver timesheets
            </Link>
          </p>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">How the features compare</h2>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            This is a feature guide from Our Family Calendar, not an independent ranking. Competitor features
            and sharing permissions vary by product and plan, and change over time — check each app's current
            details before deciding.
          </p>
          <div className="mt-6 space-y-3 md:hidden">
            {ROWS.map((r) => (
              <div key={r.label} className="rounded-lg border border-border-soft bg-card p-4">
                <h3 className="font-semibold">{r.label}</h3>
                <dl className="mt-3 space-y-3 text-sm">
                  {[
                    { name: "Our Family Calendar", value: r.ours, highlight: true },
                    { name: "Other family calendar apps", value: r.others, highlight: false },
                  ].map((option) => (
                    <div key={option.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                      <dt className={option.highlight ? "font-semibold text-primary" : "text-muted-foreground"}>{option.name}</dt>
                      <dd><Cell value={option.value} highlight={option.highlight} /></dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <div className="mt-8 hidden overflow-x-auto rounded-lg border border-border-soft bg-card shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-soft">
                  <th scope="col" className="p-4"><span className="sr-only">Feature</span></th>
                  <th scope="col" className="bg-accent p-4 font-display text-base font-bold text-accent-foreground">Our Family Calendar</th>
                  <th scope="col" className="p-4 font-semibold text-muted-foreground">Other family calendar apps</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-t border-border-soft first:border-t-0">
                    <th scope="row" className="p-4 font-semibold">{r.label}</th>
                    <td className="bg-accent/60 p-4"><Cell value={r.ours} highlight /></td>
                    <td className="p-4"><Cell value={r.others} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Which calendar is right for your family?</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {PICKS.map((p) => (
              <div key={p.name} className="rounded-lg border border-border-soft bg-card p-5">
                <h3 className="font-display text-lg font-bold">{p.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Want a deeper look at the two most common alternatives?{" "}
            <Link to="/cozi-skylight-alternative" className="font-semibold text-primary underline underline-offset-4">
              See our Cozi and Skylight comparison
            </Link>
            .
          </p>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Questions, answered</h2>
          <dl className="mt-6 space-y-6">
            {FAQ.map((f) => (
              <div key={f.question}>
                <dt className="font-display text-lg font-bold">{f.question}</dt>
                <dd className="mt-1 text-muted-foreground">{f.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-4xl bg-primary px-6 py-12 text-center shadow-lifted sm:px-10">
            <h2 className="font-display text-3xl font-bold text-primary-foreground sm:text-4xl">
              More than a shared calendar. A simpler way to coordinate family life.
            </h2>
            <div className="mt-7 flex flex-col items-center gap-3">
              <Button asChild size="lg" variant="secondary" className="h-12 rounded-full bg-primary-foreground px-7 font-bold text-primary hover:bg-primary-foreground/90">
                <Link to="/auth" search={{ mode: "signup" }}>Get started</Link>
              </Button>
              <Link
                to="/features/childcare-scheduling"
                className="text-sm font-semibold text-primary-foreground underline underline-offset-4"
              >
                Learn about childcare scheduling and timesheets
              </Link>
            </div>
          </div>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}
