import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";

import logoAsset from "@/assets/logo.png.asset.json";
import heroMonthAsset from "@/assets/landing-hero-month-desktop.png.asset.json";
import ogImageAsset from "@/assets/landing-og-image.png.asset.json";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/LegalFooter";

const SITE_URL = "https://ourfamilycalendar.com";
const PAGE_URL = `${SITE_URL}/best-shared-calendar-app`;
const OG_IMAGE_URL = `${SITE_URL}${ogImageAsset.url}`;
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
    body: "Invite babysitters, nannies and grandparents, and control who can make changes. Caregiver coverage shows right inside the family schedule.",
  },
  {
    title: "It stays a calendar",
    body: "No special hardware and no cluttered feature bundles — just a clear, calendar-first view of what's happening next.",
  },
];

type Mark = "yes" | "no" | string;
const ROWS: { label: string; ours: Mark; general: Mark; wall: Mark }[] = [
  { label: "Shared household schedule", ours: "yes", general: "yes", wall: "yes" },
  { label: "Color and initials per family member", ours: "yes", general: "Manual", wall: "Often" },
  { label: "Google Calendar integration", ours: "yes", general: "Varies", wall: "Often" },
  { label: "Babysitter & caregiver access controls", ours: "yes", general: "Limited", wall: "Varies" },
  { label: "Childcare visible in the family schedule", ours: "yes", general: "no", wall: "Varies" },
  { label: "Special hardware required", ours: "no", general: "no", wall: "yes" },
];

const FAQ = [
  {
    question: "What is the best shared calendar app for families?",
    answer:
      "The best shared calendar app for a family is one everyone can read at a glance, that connects to the calendars you already use, and that lets you include caregivers safely. Our Family Calendar was built around exactly those needs.",
  },
  {
    question: "Can I share the calendar with a babysitter?",
    answer:
      "Yes. You can invite babysitters, nannies and other caregivers and choose what they can see and change.",
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
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <img src={logoAsset.url} alt="Our Family Calendar logo" className="h-9 w-9 shrink-0 rounded-xl object-contain sm:h-10 sm:w-10" />
          <span className="truncate font-display text-base font-bold sm:text-lg">Our Family Calendar</span>
        </Link>
        <Link to="/auth">
          <Button className="h-10 rounded-full px-5 font-bold">Get started</Button>
        </Link>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 pb-12 pt-6 text-center sm:px-6 sm:pt-12 lg:px-8">
          <p className="text-sm font-bold uppercase tracking-wide text-primary">Family scheduling, simplified</p>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">
            The best shared calendar app for busy families
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Most shared calendars were built for work teams. Our Family Calendar is built for households — kids'
            activities, parents' schedules and the babysitter, all in one view.
          </p>
          <div className="mt-7">
            <Link to="/auth">
              <Button size="lg" className="h-12 rounded-full px-7 font-bold">Create your family calendar</Button>
            </Link>
          </div>
          <img
            src={heroMonthAsset.url}
            alt="Our Family Calendar month view with color-coded family events"
            className="mx-auto mt-10 w-full rounded-3xl border border-border-soft shadow-lifted"
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
          <div className="mt-8 overflow-x-auto rounded-3xl border border-border-soft bg-card shadow-soft">
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
              <Link to="/auth">
                <Button size="lg" variant="secondary" className="h-12 rounded-full bg-primary-foreground px-7 font-bold text-primary hover:bg-primary-foreground/90">
                  Get started
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}
