import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import logoAsset from "@/assets/logo.png.asset.json";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/LegalFooter";

export const SITE_URL = "https://ourfamilycalendar.com";

export type FeatureSection = { title: string; body: string };
export type FeatureFaq = { question: string; answer: string };

/** Builds head() for a public feature page: meta, canonical, SoftwareApplication, BreadcrumbList, FAQ. */
export function featureHead(opts: {
  path: string;
  title: string;
  description: string;
  crumb: string;
  imageUrl: string;
  faq: FeatureFaq[];
}) {
  const url = `${SITE_URL}${opts.path}`;
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:type", content: "article" },
      { property: "og:url", content: url },
      { property: "og:image", content: opts.imageUrl },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: opts.imageUrl },
      { name: "robots", content: "index, follow" },
    ],
    links: [{ rel: "canonical", href: url }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "SoftwareApplication",
              name: "Our Family Calendar",
              applicationCategory: "ProductivityApplication",
              operatingSystem: "Web",
              url: `${SITE_URL}/`,
              description: opts.description,
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
                { "@type": "ListItem", position: 2, name: opts.crumb, item: url },
              ],
            },
            {
              "@type": "FAQPage",
              mainEntity: opts.faq.map((f) => ({
                "@type": "Question",
                name: f.question,
                acceptedAnswer: { "@type": "Answer", text: f.answer },
              })),
            },
          ],
        }),
      },
    ],
  };
}

const linkClass = "font-semibold text-primary underline underline-offset-4";

export function MarketingFeaturePage(props: {
  eyebrow: string;
  heading: string;
  intro: string;
  image: { src: string; alt: string; width?: number; height?: number };
  sectionsTitle: string;
  sections: FeatureSection[];
  extra?: ReactNode;
  faq: FeatureFaq[];
  related: ReactNode;
  ctaTitle: string;
}) {
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
        <section className="mx-auto max-w-4xl px-4 pb-10 pt-6 text-center sm:px-6 sm:pt-12 lg:px-8">
          <p className="text-sm font-bold uppercase tracking-wide text-primary">{props.eyebrow}</p>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">{props.heading}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">{props.intro}</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Button asChild size="lg" className="h-12 rounded-full px-7 font-bold">
              <Link to="/auth" search={{ mode: "signup" }}>Create your family calendar</Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/auth" search={{ mode: "signin" }} className={linkClass}>Sign in</Link>
            </p>
          </div>
        </section>

        <figure className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <img
            src={props.image.src}
            alt={props.image.alt}
            width={props.image.width}
            height={props.image.height}
            className="mx-auto block h-auto w-full rounded-3xl border border-border-soft shadow-lifted"
            loading="eager"
          />
        </figure>

        <section className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">{props.sectionsTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-6">
            {props.sections.map((s) => (
              <article key={s.title} className="rounded-3xl border border-border-soft bg-card p-6 shadow-soft">
                <h3 className="font-display text-xl font-bold">{s.title}</h3>
                <p className="mt-2 text-muted-foreground">{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        {props.extra}

        <section className="border-y border-border-soft bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">Questions, answered</h2>
            <div className="mt-8 space-y-3">
              {props.faq.map((f) => (
                <details key={f.question} className="rounded-2xl border border-border-soft bg-card px-5 py-4 shadow-soft">
                  <summary className="cursor-pointer text-base font-bold">{f.question}</summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.answer}</p>
                </details>
              ))}
            </div>
            <p className="mt-8 text-sm text-muted-foreground">{props.related}</p>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-4xl border border-border-soft bg-primary px-6 py-12 text-center shadow-lifted sm:px-10 sm:py-16">
            <h2 className="font-display text-3xl font-bold text-primary-foreground sm:text-4xl">{props.ctaTitle}</h2>
            <p className="mx-auto mt-3 max-w-xl text-base text-primary-foreground/85 sm:text-lg">
              Family scheduling, simplified. Invite your family when you're ready.
            </p>
            <Button asChild size="lg" variant="secondary" className="mt-7 h-12 rounded-full bg-primary-foreground px-7 font-bold text-primary hover:bg-primary-foreground/90">
              <Link to="/auth" search={{ mode: "signup" }}>Get started</Link>
            </Button>
          </div>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}

export { linkClass };
