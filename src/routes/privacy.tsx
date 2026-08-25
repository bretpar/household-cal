import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/LegalPageLayout";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Our Family Calendar" },
      { name: "description", content: "Privacy Policy for Our Family Calendar." },
      { property: "og:title", content: "Privacy Policy — Our Family Calendar" },
      { property: "og:description", content: "Privacy Policy for Our Family Calendar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy">
      <section className="space-y-3">
        <h2 className="text-xl font-bold">1. Information we collect</h2>
        <p className="text-muted-foreground">[Paste finalized Privacy Policy section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">2. How we use your information</h2>
        <p className="text-muted-foreground">[Paste finalized Privacy Policy section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">3. Sharing and disclosure</h2>
        <p className="text-muted-foreground">[Paste finalized Privacy Policy section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">4. Data retention and security</h2>
        <p className="text-muted-foreground">[Paste finalized Privacy Policy section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">5. Your rights and choices</h2>
        <p className="text-muted-foreground">[Paste finalized Privacy Policy section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">6. Changes to this policy</h2>
        <p className="text-muted-foreground">[Paste finalized Privacy Policy section here.]</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">7. Contact us</h2>
        <p className="text-muted-foreground">[Paste finalized Privacy Policy section here.]</p>
      </section>
    </LegalPageLayout>
  );
}
