import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/LegalPageLayout";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Our Family Calendar" },
      { name: "description", content: "Terms of Service for Our Family Calendar." },
      { property: "og:title", content: "Terms of Service — Our Family Calendar" },
      { property: "og:description", content: "Terms of Service for Our Family Calendar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service">
      <section className="space-y-3">
        <h2 className="text-xl font-bold">1. Acceptance of terms</h2>
        <p className="text-muted-foreground">[Paste finalized Terms of Service section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">2. Description of service</h2>
        <p className="text-muted-foreground">[Paste finalized Terms of Service section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">3. User accounts and responsibilities</h2>
        <p className="text-muted-foreground">[Paste finalized Terms of Service section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">4. Acceptable use</h2>
        <p className="text-muted-foreground">[Paste finalized Terms of Service section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">5. Intellectual property</h2>
        <p className="text-muted-foreground">[Paste finalized Terms of Service section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">6. Limitation of liability</h2>
        <p className="text-muted-foreground">[Paste finalized Terms of Service section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">7. Termination</h2>
        <p className="text-muted-foreground">[Paste finalized Terms of Service section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">8. Governing law and changes</h2>
        <p className="text-muted-foreground">[Paste finalized Terms of Service section here.]</p>
      </section>
    </LegalPageLayout>
  );
}
