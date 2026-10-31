import { createFileRoute, Link } from "@tanstack/react-router";

import mobileDayAsset from "@/assets/landing-mobile-day.png.asset.json";
import { MarketingFeaturePage, featureHead, linkClass, SITE_URL } from "@/components/MarketingFeaturePage";
import { Button } from "@/components/ui/button";

const TITLE = "Nanny Timesheet & Babysitter Hours Tracker | Our Family Calendar";
const DESCRIPTION =
  "Track nanny and babysitter hours with timesheets connected to your family calendar. Schedule shifts, record actual hours, and confirm caregiver time cards.";

const STEPS = [
  { title: "Schedule shifts", body: "Parents assign babysitter or nanny shifts right on the family calendar, alongside school pickups, work and activities." },
  { title: "Prefill timesheets", body: "Scheduled hours automatically populate the caregiver's timesheet, so nobody re-enters the same plan." },
  { title: "Record actual hours", body: "Caregivers review their shifts and update actual hours when a shift runs long or ends early. Scheduled hours stay visible for comparison." },
  { title: "Review and confirm", body: "Caregivers submit their timesheets and parents review and confirm the hours in one place." },
];

const SECTIONS = [
  { title: "Schedules and timesheets in one place", body: "Caregiver shifts live on the same family calendar you already use, and timesheets start from those shifts — no separate time-tracking app to maintain." },
  { title: "Less manual entry", body: "Because timesheets are prefilled from scheduled shifts, caregivers only record what changed instead of typing every hour from scratch." },
  { title: "Caregiver-specific access", body: "Caregivers get view-only access to the calendars you choose and see only their own timesheets. They can't edit family events." },
  { title: "Parent review and confirmation", body: "Parents review each submitted time card, can request corrections, and confirm the hours before the period is done." },
  { title: "Organized historical records", body: "Confirmed timesheets stay organized by pay period, so you can look back at past hours without digging through texts or spreadsheets." },
];

const FAQ = [
  { question: "How do nanny timesheets work?", answer: "Timesheets are prefilled from the nanny shifts you schedule on your family calendar. Your caregiver reviews each shift, adjusts actual hours when needed, and submits the time card for the pay period." },
  { question: "Can babysitters update their actual hours?", answer: "Yes. Caregivers see their scheduled shifts and record the actual hours they worked before submitting. The scheduled hours stay unchanged, so parents can compare the two." },
  { question: "Can parents review and confirm caregiver timesheets?", answer: "Yes. Parents review each submitted timesheet, can ask for corrections, and confirm it. Timesheets track hours only — they don't handle payroll, payments or taxes." },
];

export const Route = createFileRoute("/features/nanny-timesheets")({
  head: () =>
    featureHead({
      path: "/features/nanny-timesheets",
      title: TITLE,
      description: DESCRIPTION,
      crumb: "Nanny timesheets",
      imageUrl: `${SITE_URL}${mobileDayAsset.url}`,
      faq: FAQ,
    }),
  component: NannyTimesheetsPage,
});

function NannyTimesheetsPage() {
  return (
    <MarketingFeaturePage
      eyebrow="Our Family Calendar · Caregiver timesheets"
      heading="Nanny Timesheets & Babysitter Hours Tracking, Made Simple"
      intro="Stop managing babysitter schedules and hours in separate places. Our Family Calendar connects caregiver shifts with timesheets, making it easier to track hours, review changes, and confirm time cards."
      secondaryCta={
        <Button asChild variant="outline" size="lg" className="h-12 rounded-full px-7 font-bold">
          <Link to="/features/childcare-scheduling">Explore Childcare Scheduling</Link>
        </Button>
      }
      image={{ src: mobileDayAsset.url, alt: "Our Family Calendar mobile Day view showing a babysitter shift alongside family activities" }}
      sectionsTitle="Why families track caregiver hours here"
      sections={SECTIONS}
      extra={
        <section className="border-y border-border-soft bg-surface">
          <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <p className="text-sm font-bold uppercase tracking-wide text-primary">Scheduled hours → actual hours → parent confirmation</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">How nanny timesheets work</h2>
            <p className="mt-4 max-w-3xl text-muted-foreground">
              Scheduled hours are the plan; actual hours are what happened. Our Family Calendar keeps
              both side by side, so a shift that runs long or ends early is easy to see and confirm.
            </p>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground" aria-hidden>{index + 1}</span>
                  <div>
                    <h3 className="font-display text-xl font-bold">{step.title}</h3>
                    <p className="mt-2 text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-8 text-sm text-muted-foreground">Timesheets track hours only — they don't handle payroll, payments or taxes.</p>
          </div>
        </section>
      }
      faq={FAQ}
      related={
        <>
          Plan the shifts behind these timesheets with{" "}
          <Link to="/features/childcare-scheduling" className={linkClass}>childcare scheduling</Link>, or see the{" "}
          <Link to="/features/family-calendar" className={linkClass}>shared family calendar</Link> everything connects to.
        </>
      }
      ctaTitle="Track caregiver hours where you already plan them."
    />
  );
}
