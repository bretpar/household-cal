import { createFileRoute, Link } from "@tanstack/react-router";

import monthAsset from "@/assets/landing-hero-month-desktop.png.asset.json";
import { MarketingFeaturePage, linkClass, SITE_URL } from "@/components/MarketingFeaturePage";

const TITLE = "Babysitter Schedule Template & Monthly Planner | Our Family Calendar";
const DESCRIPTION = "Build a flexible monthly babysitter schedule for rotating shifts, irregular work hours, and changing childcare needs. Use templates, edit shifts, and find coverage gaps.";
const PATH = "/babysitter-schedule-template";

const SECTIONS = [
  {
    title: "Start with a reusable weekly template",
    body: "Build a baseline of childcare days, times and caregivers, then use that template to start a monthly draft. Customize the month instead of rebuilding every shift when your work rotation changes.",
  },
  {
    title: "Adjust individual shifts before publishing",
    body: "Move a shift to another day, edit its hours, add extra coverage or remove a shift you no longer need. Changes stay in your draft until you review and publish them to the family calendar.",
  },
  {
    title: "Compare childcare with parent work hours",
    body: "Select parent work calendars to see available work-hour summaries alongside the monthly plan. Check Coverage highlights potential gaps and suggests shifts you can add to the draft. Missing or inaccessible calendar information, unverified import ranges and all-day work events need further review; suggestions aren't a guarantee of coverage.",
  },
  {
    title: "Plan for regular and substitute caregivers",
    body: "Assign shifts to different babysitters or nannies, including a substitute for a changing day. For caregivers with a login, choose the calendars they can see and optionally limit access to their assigned shift days. They have view-only calendar access, not permission to edit family events.",
  },
  {
    title: "Connect scheduled hours to actual hours",
    body: "For timesheet-enabled caregivers, time cards start from scheduled shifts. Caregivers with a login record their actual hours and submit their time cards; parents review and confirm them. Parents can manage time cards for eligible caregivers without a login. Timesheets track hours, not payroll, payment processing or taxes.",
  },
  {
    title: "Build on desktop, keep the calendar close",
    body: "The monthly Babysitter Schedule Builder is desktop-first for household members with edit access. Once published, shifts appear on the shared family calendar, which you and permitted caregivers can view on phones, tablets and computers. Full mobile editing in the monthly builder isn't currently supported.",
  },
];

const FAQ = [
  {
    question: "How do I plan a babysitter schedule when my work hours change?",
    answer: "Start a monthly draft from your typical weekly childcare pattern, then adjust the dates and hours to match your latest work schedule. Compare available parent work hours, review potential gaps and publish after checking the changes. This works for irregular schedules, not just a fixed Monday–Friday week.",
  },
  {
    question: "Can I reuse a babysitter schedule template each month?",
    answer: "Yes. Reusable weekly templates give each month a starting point. You can customize individual shifts in that month's draft before publishing, so the template doesn't have to match every week perfectly.",
  },
  {
    question: "Can I change one shift in a recurring babysitter schedule?",
    answer: "Yes. You can adjust or remove an individual recurring occurrence in the monthly draft and review the change before publishing, without replacing the entire recurring schedule.",
  },
  {
    question: "Can I schedule more than one babysitter?",
    answer: "Yes. Assign regular or substitute caregivers to individual shifts. Each caregiver's calendar access follows the permissions you choose; assigning a shift doesn't automatically give them full household access.",
  },
  {
    question: "What can caregivers see, and can they approve a monthly schedule?",
    answer: "Caregivers with a login have view-only access to permitted calendars, with the option to limit visibility to their assigned shift days. Recipient approval of a monthly schedule is not currently available. Caregiver timesheet submission and parent confirmation are a separate, existing workflow.",
  },
  {
    question: "Does Check Coverage guarantee that every childcare gap is found?",
    answer: "No. It compares overlapping parent work hours from selected calendars with assigned childcare shifts. Its results depend on usable calendar information. Incomplete imports, inaccessible calendars and all-day work entries require manual review, and you should confirm the plan with your caregivers.",
  },
  {
    question: "Can I use the monthly planner on my phone?",
    answer: "Use a desktop computer to build, adjust and publish the monthly schedule. Published shifts can be viewed in the family calendar on phones and tablets, subject to each person's permissions. The desktop-first monthly builder doesn't offer full native mobile editing.",
  },
];

const STEPS = [
  { title: "Build", body: "Choose the month and start with a reusable weekly template or add the childcare shifts you need." },
  { title: "Adjust", body: "Compare available work hours, check potential coverage gaps and change dates, times or caregiver assignments." },
  { title: "Review & Publish", body: "Review additions, modifications and removals, resolve conflicts, then publish the checked draft to your family calendar." },
];

export const Route = createFileRoute("/babysitter-schedule-template")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE_URL}${PATH}` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index, follow" },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}${PATH}` }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Babysitter Schedule Template", item: `${SITE_URL}${PATH}` },
        ],
      }),
    }],
  }),
  component: BabysitterScheduleTemplatePage,
});

function BabysitterScheduleTemplatePage() {
  return (
    <MarketingFeaturePage
      eyebrow="Our Family Calendar · Monthly babysitter planner"
      heading="Babysitter Scheduling for Families Who Don’t Work 9 to 5"
      intro="Your work schedule changes. Your childcare schedule should be able to change with it. Build a monthly babysitter schedule, start from a reusable template, and adjust individual shifts as your family’s needs change."
      image={{ src: monthAsset.url, alt: "Our Family Calendar desktop Month view with color-coded family activities and childcare shifts" }}
      secondaryCta={<p className="max-w-xl text-sm text-muted-foreground">Monthly schedule building is desktop-first. View published shifts on your phone, tablet or computer.</p>}
      sectionsTitle="A Monday–Friday nanny schedule doesn't fit every family"
      sections={SECTIONS}
      extra={
        <>
          <section className="border-y border-border-soft bg-surface">
            <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">Plan around the rotation, not an ideal week</h2>
              <p className="mt-4 text-muted-foreground">A physician's clinic day may follow an overnight call. A nurse or first responder may rotate between weekdays and weekends. A pilot's trips may change from month to month. A fixed weekly childcare plan can leave some days short and other days overbooked.</p>
              <p className="mt-4 text-muted-foreground">Whether you're a rotating-shift employee or simply a family with changing plans, a monthly draft lets you keep a familiar starting point without forcing every week to look the same. For example, keep your regular babysitter on two mornings, move a shift when work changes and assign a substitute for an extra afternoon.</p>
              <p className="mt-4 text-muted-foreground">Check Coverage is a planning aid, not a promise that imported calendars are complete or a caregiver is available. Review warnings and confirm arrangements before relying on the schedule.</p>
            </div>
          </section>
          <section className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">Build → Adjust → Review & Publish</h2>
            <ol className="mt-8 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="min-w-0">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground" aria-hidden>{index + 1}</span>
                  <h3 className="mt-4 font-display text-xl font-bold">{step.title}</h3>
                  <p className="mt-2 text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </>
      }
      faq={FAQ}
      related={<>Explore <Link to="/features/childcare-scheduling" className={linkClass}>childcare scheduling and caregiver access</Link>, or learn about <Link to="/features/nanny-timesheets" className={linkClass}>scheduled hours and caregiver timesheets</Link>.</>}
      ctaTitle="Make room for a work schedule that changes."
    />
  );
}