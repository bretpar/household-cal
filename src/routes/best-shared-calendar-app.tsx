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
const TITLE = "Best Shared Calendar App for Families | Our Family Calendar";
const DESCRIPTION =
  "Looking for the best shared calendar app? Compare what matters for families: color-coded members, Google Calendar sync, caregiver access and childcare in one schedule.";

const CRITERIA = [
  {
    title: "Everyone sees the same schedule",
    body: "School, sports, work, appointments and childcare live in one calendar the whole household can open on a phone, tablet or computer.",
  },
  {
    title: "You can tell who's who at a glance",
    body: "Each family member gets their own color and initials, so you know whose activity it is without opening the event.",
  },
  {
    title: "It works with the calendar you already use",
    body: "Connect Google Calendar so the events your family relies on show up automatically — no rebuilding your schedule from scratch.",
  },
  {
    title: "Caregivers get the right amount of access",
    body: "Invite babysitters, nannies and grandparents with view-only caregiver access. Choose the calendars they can see and, if needed, limit visibility to their assigned shift days. Caregiver coverage shows inside the family schedule.",
  },
  {
    title: "It stays a calendar",
    body: "Use your phone, tablet or computer without buying a dedicated calendar display. The shared schedule stays at the center of the experience.",
  },
];

type Mark = "yes" | "no" | string;
const ROWS: { label: string; ours: Mark; general: Mark; wall: Mark }[] = [
  { label: "Shared household schedule", ours: "yes", general: "yes", wall: "yes" },
  { label: "Color and initials per family member", ours: "yes", general: "Varies by app", wall: "Varies by device" },
  { label: "Google Calendar integration", ours: "yes", general: "Varies by app", wall: "Varies by device" },
  { label: "Babysitter & caregiver access controls", ours: "yes", general: "Varies by app", wall: "Varies by device" },
  { label: "Childcare visible in the family schedule", ours: "yes", general: "Can add events", wall: "Varies by device" },
  { label: "Special hardware required", ours: "no", general: "no", wall: "yes" },
];

const FAQ = [
  {
    question: "What is the best shared calendar app for families?",
    answer:
      "There is no single best app for every family. Look for a readable shared schedule, compatibility with your existing calendars and the right caregiver permissions. Our Family Calendar is an option for households that want member colors, Google Calendar connection and view-only caregiver access in one place.",
  },
  {
    question: "Can I share the calendar with a babysitter?",
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
          <p className="text-sm font-bold uppercase tracking-wide text-primary">Family scheduling, simplified</p>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">
            Choosing the best shared calendar app for your family
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Compare the features that matter to your household. Our Family Calendar brings kids' activities,
            parents' schedules and caregiver coverage into one shared view.
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
          <h2 className="font-display text-3xl font-bold sm:text-4xl">What to look for in a shared calendar app</h2>
          <ol className="mt-8 space-y-6">
            {CRITERIA.map((c, i) => (
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
        </section>

        <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">How the options compare</h2>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            This is a feature guide from Our Family Calendar, not an independent ranking. Other columns describe
            product categories, not specific brands; features and sharing permissions vary by product and plan.
            Childcare events can be added to general calendars, but dedicated caregiver visibility controls vary.
          </p>
          <div className="mt-6 space-y-3 md:hidden">
            {ROWS.map((r) => (
              <div key={r.label} className="rounded-lg border border-border-soft bg-card p-4">
                <h3 className="font-semibold">{r.label}</h3>
                <dl className="mt-3 space-y-3 text-sm">
                  {[
                    { name: "Our Family Calendar", value: r.ours, highlight: true },
                    { name: "General shared calendar", value: r.general, highlight: false },
                    { name: "Wall calendar device", value: r.wall, highlight: false },
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
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-border-soft">
                  <th scope="col" className="p-4"><span className="sr-only">Feature</span></th>
                  <th scope="col" className="bg-accent p-4 font-display text-base font-bold text-accent-foreground">Our Family Calendar</th>
                  <th scope="col" className="p-4 font-semibold text-muted-foreground">General shared calendar</th>
                  <th scope="col" className="p-4 font-semibold text-muted-foreground">Wall calendar device</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-t border-border-soft first:border-t-0">
                    <th scope="row" className="p-4 font-semibold">{r.label}</th>
                    <td className="bg-accent/60 p-4"><Cell value={r.ours} highlight /></td>
                    <td className="p-4"><Cell value={r.general} /></td>
                    <td className="p-4"><Cell value={r.wall} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              Try the shared calendar made for families
            </h2>
            <div className="mt-7">
              <Button asChild size="lg" variant="secondary" className="h-12 rounded-full bg-primary-foreground px-7 font-bold text-primary hover:bg-primary-foreground/90">
                <Link to="/auth" search={{ mode: "signup" }}>Get started</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}
