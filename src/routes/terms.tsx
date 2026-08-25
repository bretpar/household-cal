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
      <p className="text-muted-foreground">
        <strong>Effective Date:</strong> August 25, 2026
      </p>
      <p className="text-muted-foreground">
        <strong>Last Updated:</strong> August 25, 2026
      </p>

      <p className="text-muted-foreground">
        These Terms of Service ("Terms") govern your access to and use of Our Family Calendar's
        website, applications, and related services (collectively, the "Service").
      </p>

      <p className="text-muted-foreground">
        By creating an account or using the Service, you agree to these Terms.
      </p>

      <p className="text-muted-foreground">
        If you do not agree to these Terms, do not use the Service.
      </p>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">1. The Service</h2>
        <p className="text-muted-foreground">
          Our Family Calendar provides tools designed to help households organize calendars,
          activities, schedules, caregivers, and related family information.
        </p>
        <p className="text-muted-foreground">Features may include:</p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Shared family calendars</li>
          <li>Household accounts</li>
          <li>Family member assignments</li>
          <li>Activities and recurring schedules</li>
          <li>Third-party calendar synchronization</li>
          <li>Household invitations</li>
          <li>Babysitter or caregiver schedule sharing</li>
          <li>Email notifications and reminders</li>
          <li>Other family-organization tools</li>
        </ul>
        <p className="text-muted-foreground">Features may change over time.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">2. Eligibility</h2>
        <p className="text-muted-foreground">
          You must be legally capable of entering into these Terms to create and manage an account.
        </p>
        <p className="text-muted-foreground">
          The Service is primarily intended to be managed by adults. Children should not
          independently create accounts unless specifically permitted by the Service and applicable
          law.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">3. Accounts</h2>
        <p className="text-muted-foreground">You are responsible for:</p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Providing accurate account information</li>
          <li>Maintaining the security of your login credentials</li>
          <li>Activities occurring through your account</li>
          <li>Promptly notifying us of suspected unauthorized access</li>
        </ul>
        <p className="text-muted-foreground">You may not use another person's account without authorization.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">4. Households and Permissions</h2>
        <p className="text-muted-foreground">
          The Service may allow users to create households and invite other people.
        </p>
        <p className="text-muted-foreground">
          Different users may have different permissions, such as owner, administrator, member, or
          viewer permissions.
        </p>
        <p className="text-muted-foreground">
          Household owners are responsible for managing access to their household.
        </p>
        <p className="text-muted-foreground">
          You should only provide access to individuals you trust. Anyone with access may be able to
          view family schedules and other household information depending on their permissions.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">5. Your Content</h2>
        <p className="text-muted-foreground">
          You retain ownership of information and content you submit to the Service.
        </p>
        <p className="text-muted-foreground">
          You grant us a limited license to host, process, reproduce, transmit, and display that
          content solely as reasonably necessary to operate, secure, improve, and provide the
          Service.
        </p>
        <p className="text-muted-foreground">
          You represent that you have the right to provide information you enter or upload to the
          Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">6. Information About Other People</h2>
        <p className="text-muted-foreground">
          The Service allows users to enter information concerning family members, caregivers, and
          other individuals.
        </p>
        <p className="text-muted-foreground">
          You are responsible for ensuring that you have an appropriate reason or permission to enter
          and share that information.
        </p>
        <p className="text-muted-foreground">
          You should not enter unnecessary sensitive information about another person.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">7. Third-Party Calendar Services</h2>
        <p className="text-muted-foreground">
          The Service may integrate with third-party services such as Google Calendar.
        </p>
        <p className="text-muted-foreground">
          By connecting a third-party service, you authorize us to access and process information
          permitted by the authorization you provide.
        </p>
        <p className="text-muted-foreground">
          Third-party services are governed by their own terms and privacy policies.
        </p>
        <p className="text-muted-foreground">
          We are not responsible for interruptions, data changes, permission changes, account
          restrictions, or other actions caused by third-party services.
        </p>
        <p className="text-muted-foreground">
          You may disconnect supported integrations at any time through available controls or through
          the applicable third-party provider.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">8. Calendar Accuracy</h2>
        <p className="text-muted-foreground">
          Our Family Calendar is an organizational tool. Although we work to provide accurate
          synchronization and scheduling functionality, we cannot guarantee that calendar information
          will always be complete, current, synchronized, or error-free.
        </p>
        <p className="text-muted-foreground">
          Users remain responsible for verifying important dates, times, appointments, childcare
          arrangements, travel plans, deadlines, and other time-sensitive information.
        </p>
        <p className="text-muted-foreground">
          Do not rely on the Service as the sole source of information for emergencies, medical care,
          safety-critical activities, or other situations where an incorrect or delayed calendar
          entry could cause significant harm.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">9. Acceptable Use</h2>
        <p className="text-muted-foreground">You may not use the Service to:</p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Violate applicable law</li>
          <li>Access another user's account or household without authorization</li>
          <li>Circumvent security or permission controls</li>
          <li>Interfere with the operation of the Service</li>
          <li>Introduce malicious software or harmful code</li>
          <li>Scrape or systematically extract information without authorization</li>
          <li>Harass, threaten, impersonate, or harm another person</li>
          <li>Use the Service for fraudulent or deceptive purposes</li>
          <li>Attempt to discover vulnerabilities except through an authorized security-testing program</li>
          <li>Use information about children for unlawful or inappropriate purposes</li>
        </ul>
        <p className="text-muted-foreground">
          We may restrict or terminate access when we reasonably believe these Terms have been
          violated.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">10. Communications</h2>
        <p className="text-muted-foreground">
          By providing an email address and using communication features, you authorize us to send
          service-related communications such as:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Account notices</li>
          <li>Household invitations</li>
          <li>Calendar notifications</li>
          <li>Security notices</li>
          <li>Schedule summaries</li>
          <li>Service updates</li>
        </ul>
        <p className="text-muted-foreground">
          Where required by law, marketing communications will be handled separately and will include
          applicable opt-out mechanisms.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">11. Free and Paid Features</h2>
        <p className="text-muted-foreground">The Service may offer free and paid features.</p>
        <p className="text-muted-foreground">
          If paid subscriptions are introduced, applicable pricing, billing periods, renewal terms,
          cancellation policies, and additional terms will be disclosed before purchase.
        </p>
        <p className="text-muted-foreground">
          We may change which features are available in particular plans, subject to applicable law
          and commitments made to existing subscribers.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">12. Availability and Changes</h2>
        <p className="text-muted-foreground">
          We may modify, update, suspend, or discontinue portions of the Service.
        </p>
        <p className="text-muted-foreground">We do not guarantee uninterrupted or error-free availability.</p>
        <p className="text-muted-foreground">
          Maintenance, technical failures, third-party outages, internet disruptions, and
          circumstances outside our control may temporarily affect the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">13. Account Suspension and Termination</h2>
        <p className="text-muted-foreground">You may stop using the Service at any time.</p>
        <p className="text-muted-foreground">
          We may suspend or terminate access when reasonably necessary to:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Protect users or the Service</li>
          <li>Address suspected fraud or security threats</li>
          <li>Comply with legal obligations</li>
          <li>Enforce these Terms</li>
        </ul>
        <p className="text-muted-foreground">
          Where appropriate, we may provide notice or an opportunity to resolve an issue before
          termination.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">14. Disclaimers</h2>
        <p className="text-muted-foreground">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED "AS IS" AND "AS
          AVAILABLE."
        </p>
        <p className="text-muted-foreground">
          WE DISCLAIM WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
          NON-INFRINGEMENT, AND ANY OTHER WARRANTIES THAT MAY OTHERWISE APPLY, EXCEPT TO THE EXTENT
          SUCH WARRANTIES CANNOT LEGALLY BE DISCLAIMED.
        </p>
        <p className="text-muted-foreground">
          We do not guarantee that the Service will always be available, secure, accurate, or free
          from errors.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">15. Limitation of Liability</h2>
        <p className="text-muted-foreground">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR FAMILY CALENDAR AND ITS OWNERS, OPERATORS,
          AFFILIATES, EMPLOYEES, AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL,
          SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES ARISING FROM OR RELATED TO YOUR USE
          OF THE SERVICE.
        </p>
        <p className="text-muted-foreground">
          This includes, where permitted by law, damages resulting from lost information, missed
          appointments, calendar synchronization errors, service interruptions, or unauthorized
          access.
        </p>
        <p className="text-muted-foreground">
          Nothing in these Terms limits liability that cannot legally be limited.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">16. Indemnification</h2>
        <p className="text-muted-foreground">
          To the extent permitted by law, you agree to indemnify and hold harmless Our Family Calendar
          and its owners, operators, affiliates, and service providers from claims arising from your
          unlawful use of the Service, violation of these Terms, or infringement of another person's
          rights.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">17. Intellectual Property</h2>
        <p className="text-muted-foreground">
          The Service, including its software, branding, design, logos, and original content, is
          owned by or licensed to Our Family Calendar and is protected by applicable
          intellectual-property laws.
        </p>
        <p className="text-muted-foreground">
          These Terms do not grant you ownership of the Service or its intellectual property.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">18. Privacy</h2>
        <p className="text-muted-foreground">
          Our collection and use of personal information is described in our Privacy Policy.
        </p>
        <p className="text-muted-foreground">
          By using the Service, you acknowledge the Privacy Policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">19. Changes to These Terms</h2>
        <p className="text-muted-foreground">
          We may update these Terms from time to time.
        </p>
        <p className="text-muted-foreground">
          If we make material changes, we may provide notice through the Service, by email, or through
          another reasonable method.
        </p>
        <p className="text-muted-foreground">
          Your continued use of the Service after updated Terms become effective constitutes
          acceptance of those Terms to the extent permitted by law.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">20. Governing Law</h2>
        <p className="text-muted-foreground">
          These Terms are governed by the laws of the State of Washington, without regard to its
          conflict-of-laws principles, except where applicable law requires otherwise.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">21. Severability</h2>
        <p className="text-muted-foreground">
          If any provision of these Terms is determined to be invalid or unenforceable, the remaining
          provisions will remain in effect.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">22. Entire Agreement</h2>
        <p className="text-muted-foreground">
          These Terms, together with the Privacy Policy and any additional terms presented for
          specific features, constitute the agreement between you and Our Family Calendar regarding
          use of the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">23. Contact</h2>
        <p className="text-muted-foreground">
          Questions regarding these Terms may be submitted through the contact information provided
          on the Our Family Calendar website.
        </p>
        <p className="font-semibold">Our Family Calendar</p>
        <p className="text-muted-foreground">ourfamilycalendar.com</p>
      </section>
    </LegalPageLayout>
  );
}
