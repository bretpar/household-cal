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
