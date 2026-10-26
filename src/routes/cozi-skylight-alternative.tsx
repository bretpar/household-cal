import { createFileRoute, Link } from "@tanstack/react-router";

import heroMonthAsset from "@/assets/landing-hero-month-desktop.png.asset.json";
import { MarketingFeaturePage, featureHead, linkClass, SITE_URL } from "@/components/MarketingFeaturePage";

const TITLE = "Cozi & Skylight Alternative for Families With a Nanny | Our Family Calendar";
const DESCRIPTION =
  "Looking for a Cozi or Skylight alternative? Our Family Calendar is a shared family calendar with nanny scheduling, view-only caregiver access and timesheets — no wall display needed.";

const SECTIONS = [
  { title: "No hardware to buy", body: "Wall displays like Skylight put the calendar on a screen in your kitchen. Our Family Calendar runs on the phones, tablets and computers your family already has, so the schedule goes wherever you are." },
  { title: "Built around childcare", body: "Family organizer apps like Cozi cover lists, meals and calendars. Our Family Calendar focuses on the schedule itself, with nanny and babysitter shifts shown right beside work, school and activities." },
  { title: "Caregiver access you control", body: "Give nannies, babysitters and grandparents view-only access to just the calendars you choose, and optionally only the days they work." },
  { title: "Timesheets tied to shifts", body: "Time cards start from scheduled shifts, caregivers record actual hours, and parents review and confirm them. Timesheets track hours only — not payroll, payments or taxes." },
  { title: "Works with Google Calendar", body: "Connect Google Calendar so the events you already keep there appear automatically." },
  { title: "Colors for every family member", body: "Each person gets a color and initials, so you can tell whose event it is at a glance." },
];

const FAQ = [
  { question: "Is Our Family Calendar a Cozi alternative?", answer: "It can be, especially if childcare is a big part of your week. It focuses on a shared family schedule with nanny shifts, view-only caregiver access and timesheets. Features of other apps vary by product and plan, so compare what matters to your household." },
  { question: "Is it a Skylight alternative?", answer: "If you'd rather not buy a wall display, yes. Our Family Calendar works on the phones, tablets and computers you already own, and a tablet can stay on the counter as a family screen." },
  { question: "Can I share it with my nanny?", answer: "Yes. Caregivers get view-only access to the calendars you choose and can't edit family events." },
  { question: "Does it sync with Google Calendar?", answer: "Yes. You can connect Google Calendar so existing events show up in your family calendar." },
];

export const Route = createFileRoute("/cozi-skylight-alternative")({
  head: () =>
    featureHead({
      path: "/cozi-skylight-alternative",
      title: TITLE,
      description: DESCRIPTION,
      crumb: "Cozi & Skylight alternative",
      imageUrl: `${SITE_URL}${heroMonthAsset.url}`,
      faq: FAQ,
    }),
  component: AlternativePage,
});

function AlternativePage() {
  return (
    <MarketingFeaturePage
      eyebrow="Comparing family calendar options"
      heading="A Cozi and Skylight alternative for families with childcare"
      intro="Cozi and Skylight are well-known ways to organize a family. If your week also runs on a nanny or babysitter schedule, Our Family Calendar keeps childcare, work and kids' activities in one shared calendar — on the devices you already have."
      image={{ src: heroMonthAsset.url, alt: "Our Family Calendar month view with color-coded family events", width: 1171, height: 884 }}
      sectionsTitle="Why families with a nanny choose Our Family Calendar"
      sections={SECTIONS}
      faq={FAQ}
      related={
        <>
          Cozi and Skylight are trademarks of their respective owners; this guide is from Our Family Calendar and isn't affiliated with them. See the{" "}
          <Link to="/best-shared-calendar-app" className={linkClass}>full feature comparison</Link> or{" "}
          <Link to="/features/childcare-scheduling" className={linkClass}>nanny scheduling features</Link>.
        </>
      }
      ctaTitle="Try the family calendar built around childcare."
    />
  );
}
