import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowRight, CalendarDays, ChevronDown, Clock3, Heart, Users } from "lucide-react";
import logoAsset from "@/assets/logo.png.asset.json";
import planningAsset from "@/assets/caregiver-planning.jpg.asset.json";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/LegalFooter";
import { SITE_URL } from "@/components/MarketingFeaturePage";

const title = "Babysitter Hours Tracker & Scheduling App | Our Family Calendar";
const description = "Organize babysitting shifts across families, track scheduled and actual hours, and prepare weekly babysitter timesheets in your own private caregiver workspace.";
const url = `${SITE_URL}/caregiver`;
const imageUrl = `${SITE_URL}${planningAsset.url}`;
const signupSearch = { mode: "signup" as const, redirect: "/caregiver/onboarding" };
const features = [
  { icon: CalendarDays, tone: "bg-member-sky-soft text-member-sky-ink", title: "Every shift, one schedule", body: "Add your babysitting shifts and see what’s next in Today, Day, Week and Month views. Keep the families you work with together in your own calendar." },
  { icon: Clock3, tone: "bg-member-rose-soft text-member-rose-ink", title: "Know the hours you worked", body: "Start with your scheduled hours, adjust your actual start and end times, and confirm each shift. Review scheduled and confirmed hours in a weekly timesheet for each family." },
  { icon: Users, tone: "bg-member-sage-soft text-member-sage-ink", title: "Different families. Less juggling.", body: "Keep family contacts and color-coded shifts organized in your private workspace. Switch between families in Timesheets without mixing their hours." },
];
const steps = [
  { title: "Make it yours", body: "Create an account, then choose “I’m a Caregiver” on the Welcome screen." },
  { title: "Add your families and shifts", body: "Save your family contacts and put upcoming shifts on your calendar." },
  { title: "Keep your hours up to date", body: "Confirm or adjust your hours after each shift, then check each family’s weekly timesheet." },
];
const faq = [
  { question: "Can I use this if I babysit for more than one family?", answer: "Yes. Your independent caregiver workspace lets you add multiple family contacts and organize their shifts in one calendar. Weekly timesheets are kept separate for each family." },
  { question: "Do the families I work for need an account?", answer: "No. You can add family contacts and manage your own shifts and hours without asking a parent to sign up. This is your private workspace, not a connection to a family’s household calendar." },
  { question: "Can I record my actual babysitting hours?", answer: "Yes. Each shift starts with its scheduled times. You can confirm those times or adjust the actual start and end, add a note, and review your confirmed hours by family and week." },
  { question: "Can I download a timesheet?", answer: "Yes. In the browser, you can download a PDF for the selected family and week. Prepare email downloads that PDF and opens an email draft with a summary; you attach the downloaded PDF yourself before sending." },
  { question: "Can I connect Google Calendar?", answer: "You can optionally connect your own Google Calendar and send your caregiver shifts to a selected calendar. You can also use your workspace without connecting Google. Apple Calendar sync is not included." },
  { question: "Does it handle payroll or connect to a parent’s household?", answer: "No. Independent caregiver timesheets help you keep a record of your hours. They don’t process payments, payroll or taxes, and your workspace is not linked to a parent’s Our Family Calendar household." },
];

export const Route = createFileRoute("/caregiver")({
  head: () => ({
    meta: [
      { title }, { name: "description", content: description },
      { property: "og:title", content: title }, { property: "og:description", content: description },
      { property: "og:type", content: "website" }, { property: "og:url", content: url },
      { property: "og:image", content: imageUrl },
      { property: "og:image:width", content: "1200" }, { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "A caregiver planning her work week at a kitchen table" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title }, { name: "twitter:description", content: description },
      { name: "twitter:image", content: imageUrl }, { name: "robots", content: "index, follow" },
    ],
    links: [{ rel: "canonical", href: url }],
    scripts: [{ type: "application/ld+json", children: JSON.stringify({
      "@context": "https://schema.org", "@type": "SoftwareApplication",
      name: "Our Family Calendar", applicationCategory: "ProductivityApplication",
      operatingSystem: "Web", url, description,
      featureList: ["Independent caregiver shift scheduling", "Multiple family contacts", "Weekly scheduled and confirmed actual hours", "Family-specific PDF timesheets"],
    }) }],
  }),
  component: CaregiverLandingPage,
});

function CaregiverLandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <img src={logoAsset.url} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
          <span className="font-display text-sm font-bold sm:text-lg">Our Family Calendar</span>
        </Link>
        <nav aria-label="Account" className="shrink-0">
          <Button asChild variant="ghost" className="h-11 rounded-full font-bold text-primary"><Link to="/auth" search={{ mode: "signin", redirect: "/caregiver/today" }}>Sign in</Link></Button>
        </nav>
      </header>
      <main>
        <section className="relative isolate overflow-hidden border-y border-border-soft">
          <img src={planningAsset.url} alt="A caregiver planning her work week at a kitchen table" width={1200} height={630} fetchPriority="high" className="absolute inset-x-0 top-0 -z-10 h-60 w-full object-cover object-right md:h-full" />
          <div className="mx-auto max-w-6xl px-5 pb-10 pt-64 sm:px-6 md:py-20 lg:px-8 lg:py-24">
            <div className="max-w-md md:max-w-[44%]">
              <p className="flex items-center gap-2 text-sm font-bold text-primary"><Heart className="size-4" aria-hidden="true" /> For babysitters, nannies & caregivers</p>
              <h1 className="mt-4 font-display text-4xl font-bold leading-tight sm:text-5xl">Your babysitting schedule, all in one place.</h1>
              <p className="mt-5 text-lg leading-relaxed">Organize your shifts, keep track of your hours, and make babysitting work easier to manage.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg" className="h-12 rounded-full px-6 font-bold"><Link to="/auth" search={signupSearch}>Get Started <ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full bg-background px-5 font-bold"><a href="#how-it-works">See How It Works <ArrowDown className="size-4" aria-hidden="true" /></a></Button>
              </div>
              <p className="mt-4 text-sm">Your workspace. Your families. Your week.</p>
            </div>
          </div>
        </section>
        <section aria-labelledby="features-heading" className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
          <p className="text-sm font-bold text-primary">A little more organized. A lot less juggling.</p>
          <h2 id="features-heading" className="mt-3 max-w-2xl font-display text-3xl font-bold sm:text-4xl">A babysitting schedule and hours tracker that works for you.</h2>
          <div className="mt-9 grid gap-8 md:grid-cols-3 md:gap-10">
            {features.map(({ icon: Icon, tone, title: heading, body }) => <article key={heading}>
              <div className={`grid size-12 place-items-center rounded-full ${tone}`}><Icon className="size-6" aria-hidden="true" /></div>
              <h3 className="mt-4 font-display text-xl font-bold">{heading}</h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">{body}</p>
            </article>)}
          </div>
        </section>
        <section id="how-it-works" aria-labelledby="steps-heading" className="scroll-mt-6 border-y border-border-soft bg-member-sage-soft">
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
            <h2 id="steps-heading" className="font-display text-3xl font-bold sm:text-4xl">From your first shift to your weekly timesheet.</h2>
            <ol className="mt-9 grid gap-8 md:grid-cols-3 md:gap-10">
              {steps.map((step, index) => <li key={step.title}>
                <span className="font-display text-4xl font-bold text-member-sage-ink">0{index + 1}</span>
                <h3 className="mt-3 text-lg font-bold">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-member-sage-ink">{step.body}</p>
              </li>)}
            </ol>
            <Button asChild className="mt-8 h-12 rounded-full px-6 font-bold"><Link to="/auth" search={signupSearch}>Get Started <ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
          </div>
        </section>
        <section aria-labelledby="faq-heading" className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
          <h2 id="faq-heading" className="font-display text-3xl font-bold sm:text-4xl">A few things you might be wondering.</h2>
          <div className="mt-7 divide-y divide-border">
            {faq.map(item => <details key={item.question} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-bold [&::-webkit-details-marker]:hidden">{item.question}<ChevronDown className="mt-1 size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
              <p className="mt-3 leading-relaxed text-muted-foreground">{item.answer}</p>
            </details>)}
          </div>
          <p className="mt-7 text-sm text-muted-foreground">Looking for childcare planning as a parent? <Link to="/features/childcare-scheduling" className="font-semibold text-primary underline underline-offset-4">Explore family childcare scheduling.</Link></p>
        </section>
        <section className="bg-member-rose-soft px-5 py-12 text-center sm:px-6 sm:py-16">
          <Heart className="mx-auto size-7 text-member-rose-ink" aria-hidden="true" />
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold sm:text-4xl">Make room for a more organized week.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg">Your next shift, your worked hours, and every family you care for — together in Our Family Calendar.</p>
          <Button asChild size="lg" className="mt-7 h-12 rounded-full px-7 font-bold"><Link to="/auth" search={signupSearch}>Get Started <ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}
