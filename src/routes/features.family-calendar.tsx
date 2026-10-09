import { createFileRoute, Link } from "@tanstack/react-router";

import heroMonthAsset from "@/assets/landing-hero-month-desktop.png.asset.json";
import { MarketingFeaturePage, featureHead, linkClass, SITE_URL } from "@/components/MarketingFeaturePage";

const TITLE = "Shared Family Calendar App for Busy Families | Our Family Calendar";
const DESCRIPTION =
  "Keep your family’s appointments, activities, and schedules organized with color-coded calendars, Google Calendar sync, and shared household access.";

const SECTIONS = [
  { title: "One household schedule", body: "Everyone in the household opens the same calendar on a phone, tablet or computer, so school, work and activities are all in one place." },
  { title: "Color-coded family members", body: "Each person gets a color and initials, so you can tell whose soccer practice or dentist appointment it is at a glance." },
  { title: "Day, week and month views", body: "Zoom in on today's pickups or step back to see the whole month. Filter by family member when you only need one person's plans." },
  { title: "Google Calendar sync", body: "Connect Google Calendar so the events you already keep there appear in your family calendar without re-entering them." },
  { title: "Recurring activities", body: "Set up weekly lessons, practices and routines once with repeat rules, and keep them organized alongside one-off events." },
  { title: "Schedule summaries by email", body: "Optional daily, weekly or monthly email summaries help everyone see what's ahead without checking the app constantly." },
  { title: "Household and caregiver access", body: "Partners can get full access while babysitters and grandparents get view-only access to only the calendars you choose." },
  { title: "Childcare in the same view", body: "Babysitter and nanny shifts sit right next to the activities they cover, so gaps in coverage are easy to spot." },
];

const FAQ = [
  { question: "What is a shared family calendar?", answer: "It's one calendar the whole household can see and update, so everyone works from the same schedule instead of texts and separate calendars." },
  { question: "Does it work with Google Calendar?", answer: "Yes. You can connect Google Calendar so existing events show up in your family calendar." },
  { question: "Can I use it with Apple Calendar?", answer: "You can subscribe to calendar feeds so events can be viewed in calendar apps that support subscriptions. Full two-way Apple Calendar integration is not available." },
  { question: "Can my babysitter see the calendar?", answer: "Yes, with view-only caregiver access. You choose which calendars they can see, and they can't edit family events." },
];

export const Route = createFileRoute("/features/family-calendar")({
  head: () =>
    featureHead({
      path: "/features/family-calendar",
      title: TITLE,
      description: DESCRIPTION,
      crumb: "Shared family calendar",
      imageUrl: `${SITE_URL}${heroMonthAsset.url}`,
      faq: FAQ,
    }),
  component: FamilyCalendarPage,
});

function FamilyCalendarPage() {
  return (
    <MarketingFeaturePage
      eyebrow="Shared family calendar"
      heading="One Shared Calendar for Your Whole Family"
      intro="School pickups, sports, appointments, work schedules and babysitting — Our Family Calendar puts your household's plans in one color-coded calendar everyone can see."
      image={{ src: heroMonthAsset.url, alt: "Our Family Calendar Month view with color-coded events for each family member" }}
      sectionsTitle="Everything your family schedule needs"
      sections={SECTIONS}
      extra={
        <section className="border-t border-border-soft bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">What a week looks like</h2>
            <ul className="mt-6 list-disc space-y-3 pl-5 text-muted-foreground">
              <li>Monday's school pickup shows who's driving, in that parent's color.</li>
              <li>Tuesday's soccer practice repeats every week without re-entering it.</li>
              <li>Wednesday's work meeting from Google Calendar appears automatically.</li>
              <li>Thursday's babysitter shift covers the evening when both parents are out.</li>
            </ul>
          </div>
        </section>
      }
      faq={FAQ}
      related={
        <>
          Need help with babysitters? Read about{" "}
          <Link to="/features/childcare-scheduling" className={linkClass}>babysitter and nanny scheduling</Link>, or see how we{" "}
          <Link to="/best-shared-calendar-app" className={linkClass}>compare to other shared calendar apps</Link>.
        </>
      }
      ctaTitle="Bring your family's schedule together."
    />
  );
}
