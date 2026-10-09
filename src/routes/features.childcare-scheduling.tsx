import { createFileRoute, Link } from "@tanstack/react-router";

import mobileDayAsset from "@/assets/landing-mobile-day.png.asset.json";
import { MarketingFeaturePage, featureHead, linkClass, SITE_URL } from "@/components/MarketingFeaturePage";

const TITLE = "Babysitter & Nanny Scheduling and Timesheets | Our Family Calendar";
const DESCRIPTION =
  "Schedule babysitters and nannies, share caregiver calendars, track work hours, and review timesheets—all alongside your family’s activities.";

const SECTIONS = [
  { title: "Schedule shifts", body: "Add childcare shifts right on your family calendar and assign each one to the right babysitter or nanny." },
  { title: "Keep caregivers informed", body: "Caregivers get view-only access to the schedules you allow. They can see their shifts but can't edit family events." },
  { title: "Share upcoming schedules", body: "Caregivers can receive email summaries of their scheduled days, so there's less back-and-forth by text." },
  { title: "Track scheduled and actual hours", body: "Caregiver timesheets start from the scheduled shifts. Actual hours can be reviewed and corrected when a shift runs long or ends early." },
  { title: "Review and confirm timesheets", body: "Caregivers submit their time cards and parents review and confirm them in one place." },
  { title: "Manage childcare in one place", body: "Shifts live alongside appointments, school activities and sports, so you can see exactly what each shift covers." },
];

const FAQ = [
  { question: "Is this a babysitter scheduling app?", answer: "Yes. You can schedule babysitter shifts on your family calendar and assign them to a caregiver, who can view their shifts with view-only access." },
  { question: "Does it work for nanny scheduling?", answer: "Yes. Recurring nanny shifts can be set up with repeat rules and shown alongside the rest of your family's schedule." },
  { question: "How do babysitter timesheets work?", answer: "Timesheets are prefilled from scheduled shifts. Caregivers can adjust actual hours and submit, and parents review and confirm them. Timesheets track hours only — they don't handle payroll, payments or taxes." },
  { question: "What can a caregiver see on the calendar?", answer: "Only the calendars you choose. You can also limit their view to the days they're scheduled to work. Caregivers can't edit family events." },
];

const TIMESHEET_STEPS = [
  { title: "Schedule a caregiver", body: "Assign babysitter or nanny shifts on your family calendar." },
  { title: "Start with scheduled hours", body: "Time cards are automatically prefilled from those scheduled shifts." },
  { title: "Record actual hours", body: "Caregivers adjust their actual hours when needed and submit their timesheets." },
  { title: "Review and confirm", body: "Parents review the time card and confirm the hours in one place." },
];

export const Route = createFileRoute("/features/childcare-scheduling")({
  head: () =>
    featureHead({
      path: "/features/childcare-scheduling",
      title: TITLE,
      description: DESCRIPTION,
      crumb: "Babysitter & nanny scheduling",
      imageUrl: `${SITE_URL}${mobileDayAsset.url}`,
      faq: FAQ,
    }),
  component: ChildcarePage,
});

function ChildcarePage() {
  return (
    <MarketingFeaturePage
      eyebrow="Childcare scheduling calendar"
      heading="Babysitter & Nanny Scheduling Made Simple"
      intro="Schedule shifts, share the right calendars with your caregivers, and keep track of hours with built-in timesheets — all inside your family calendar."
      image={{ src: mobileDayAsset.url, alt: "Our Family Calendar mobile Day view showing activities and babysitter coverage" }}
      sectionsTitle="How childcare scheduling works"
      sections={SECTIONS}
      extra={
        <section className="border-y border-border-soft bg-surface">
          <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <p className="text-sm font-bold uppercase tracking-wide text-primary">Scheduled shifts → actual hours → parent confirmation</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">From the family schedule to a confirmed timesheet</h2>
            <p className="mt-4 max-w-3xl text-muted-foreground">
              A babysitter timesheet or nanny hours tracker works best when it starts with the
              schedule you already use. Built-in timesheets keep caregiver scheduling and
              hour tracking together, so you don't have to maintain two separate systems.
            </p>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2">
              {TIMESHEET_STEPS.map((step, index) => (
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
          Learn more about the{" "}
          <Link to="/features/family-calendar" className={linkClass}>shared family calendar</Link>, or see how we{" "}
          <Link to="/best-shared-calendar-app" className={linkClass}>compare to other shared calendar apps</Link>.
        </>
      }
      ctaTitle="Make childcare part of the plan."
    />
  );
}
