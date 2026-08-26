import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/LegalPageLayout";

const LOGO_IMAGE_URL =
  "https://ourfamilycalendar.com/__l5e/assets-v1/1cbc3ae6-235d-438e-9bff-3eace728929e/logo.png";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Our Family Calendar" },
      { name: "description", content: "Privacy Policy for Our Family Calendar." },
      { property: "og:title", content: "Privacy Policy — Our Family Calendar" },
      { property: "og:description", content: "Privacy Policy for Our Family Calendar." },
      { property: "og:image", content: LOGO_IMAGE_URL },
      { name: "twitter:image", content: LOGO_IMAGE_URL },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy">
      <p className="text-muted-foreground">
        <strong>Effective Date:</strong> August 25, 2026
      </p>
      <p className="text-muted-foreground">
        <strong>Last Updated:</strong> August 25, 2026
      </p>

      <p className="text-muted-foreground">
        Our Family Calendar ("Our Family Calendar," "we," "us," or "our") respects your privacy.
        This Privacy Policy explains how we collect, use, store, and protect information when you
        use our website, applications, and related services (collectively, the "Service").
      </p>

      <p className="text-muted-foreground">
        By using the Service, you acknowledge the practices described in this Privacy Policy.
      </p>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">1. Information We Collect</h2>

        <h3 className="text-lg font-semibold">Account Information</h3>
        <p className="text-muted-foreground">
          When you create or use an account, we may collect information such as:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Name</li>
          <li>Email address</li>
          <li>Account and household membership information</li>
          <li>Account role or permissions</li>
          <li>Authentication and login information</li>
          <li>Preferences and settings</li>
        </ul>
        <p className="text-muted-foreground">
          Passwords are handled through our authentication systems and are not intended to be stored
          by us in readable form.
        </p>

        <h3 className="text-lg font-semibold">Family and Household Information</h3>
        <p className="text-muted-foreground">
          The Service allows users to organize information about their household. Depending on how
          you use the Service, this may include:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Family member names, nicknames, or initials</li>
          <li>Family member colors or identifiers</li>
          <li>Activities and schedules</li>
          <li>Calendar events</li>
          <li>School, childcare, work, appointment, travel, and activity information</li>
          <li>Babysitter or caregiver schedules</li>
          <li>Notes and other information entered by users</li>
        </ul>
        <p className="text-muted-foreground">
          Users control the information they choose to enter into the Service.
        </p>

        <h3 className="text-lg font-semibold">Calendar Information</h3>
        <p className="text-muted-foreground">
          If you choose to connect a third-party calendar service, such as Google Calendar, we may
          access calendar information necessary to provide the features you authorize.
        </p>
        <p className="text-muted-foreground">
          This may include calendar names, event titles, dates, times, recurrence information,
          descriptions, and other calendar metadata.
        </p>
        <p className="text-muted-foreground">
          We use this information to provide calendar synchronization and related features. We do not
          access a third-party calendar unless you choose to connect it and authorize the requested
          permissions.
        </p>
        <p className="text-muted-foreground">
          You may disconnect a connected calendar according to the options provided by the Service or
          the third-party provider.
        </p>

        <h3 className="text-lg font-semibold">Communications</h3>
        <p className="text-muted-foreground">
          If you use invitation, notification, reminder, or scheduling features, we may process
          names, email addresses, event information, and other information necessary to deliver those
          communications.
        </p>

        <h3 className="text-lg font-semibold">Technical Information</h3>
        <p className="text-muted-foreground">
          When you use the Service, certain technical information may be collected automatically,
          including:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>IP address</li>
          <li>Browser and device information</li>
          <li>Operating system</li>
          <li>Dates and times of access</li>
          <li>Application activity</li>
          <li>Error and diagnostic information</li>
          <li>Security and authentication events</li>
        </ul>
        <p className="text-muted-foreground">
          We may use cookies, local storage, and similar technologies necessary to operate, secure,
          and improve the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">2. How We Use Information</h2>
        <p className="text-muted-foreground">We may use information to:</p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Create and maintain user accounts</li>
          <li>Provide household and family-calendar functionality</li>
          <li>Display and synchronize calendar events</li>
          <li>Manage household members, invitations, and permissions</li>
          <li>Send invitations, reminders, notifications, and other requested communications</li>
          <li>Maintain and improve the Service</li>
          <li>Diagnose technical problems</li>
          <li>Protect against fraud, abuse, and unauthorized access</li>
          <li>Provide customer support</li>
          <li>Comply with applicable legal obligations</li>
        </ul>
        <p className="text-muted-foreground">We do not sell your personal information.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">3. Google User Data</h2>
        <p className="text-muted-foreground">
          If you connect your Google account, our use of information received from Google APIs will
          comply with applicable Google API Services User Data policies.
        </p>
        <p className="text-muted-foreground">
          Google Calendar information is accessed only as necessary to provide the calendar features
          you authorize.
        </p>
        <p className="text-muted-foreground">
          We do not sell Google user data or use Google Calendar data for advertising.
        </p>
        <p className="text-muted-foreground">
          You can revoke the Service's access to your Google account through your Google account
          permissions or through available connection controls within the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">4. Household Sharing</h2>
        <p className="text-muted-foreground">
          Our Family Calendar is designed to allow information to be shared among members of a
          household.
        </p>
        <p className="text-muted-foreground">
          Depending on their permissions, household members may be able to view information such as:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Calendar events</li>
          <li>Family member assignments</li>
          <li>Activities</li>
          <li>Schedules</li>
          <li>Event details</li>
          <li>Household information</li>
        </ul>
        <p className="text-muted-foreground">
          You should only invite people you trust to your household.
        </p>
        <p className="text-muted-foreground">
          Household owners and administrators are responsible for deciding who receives access and
          what information is entered into the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">5. Information About Children</h2>
        <p className="text-muted-foreground">
          Our Family Calendar may be used by parents or guardians to organize schedules and activities
          involving children.
        </p>
        <p className="text-muted-foreground">
          The Service is intended to be managed by adults and is not intended for children to
          independently create accounts or provide personal information without appropriate parental
          or guardian involvement.
        </p>
        <p className="text-muted-foreground">
          Parents and guardians should avoid entering unnecessary sensitive information about
          children.
        </p>
        <p className="text-muted-foreground">
          If you believe personal information about a child has been collected improperly, please
          contact us so that we can investigate and, when appropriate, remove it.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">6. Service Providers</h2>
        <p className="text-muted-foreground">
          We may use third-party service providers to operate portions of the Service, including
          providers of:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Hosting and cloud infrastructure</li>
          <li>Authentication</li>
          <li>Database services</li>
          <li>Email delivery</li>
          <li>Calendar integrations</li>
          <li>Error monitoring and security</li>
          <li>Analytics</li>
        </ul>
        <p className="text-muted-foreground">
          These providers may process information on our behalf as necessary to provide their services.
        </p>
        <p className="text-muted-foreground">
          We may also disclose information when required by law or when reasonably necessary to
          protect the rights, safety, and security of our users, the Service, or others.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">7. Data Retention</h2>
        <p className="text-muted-foreground">
          We retain information for as long as reasonably necessary to provide the Service, maintain
          legitimate business records, comply with legal obligations, resolve disputes, and protect
          the security of the Service.
        </p>
        <p className="text-muted-foreground">
          When an account or household is deleted, associated information may be deleted or anonymized
          subject to technical, legal, security, and backup-retention requirements.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">8. Data Security</h2>
        <p className="text-muted-foreground">
          We use reasonable administrative, technical, and organizational safeguards designed to
          protect information from unauthorized access, disclosure, alteration, or destruction.
        </p>
        <p className="text-muted-foreground">
          However, no internet-based service or method of electronic storage can guarantee absolute
          security.
        </p>
        <p className="text-muted-foreground">
          Users are responsible for protecting their account credentials and should notify us if they
          believe their account has been compromised.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">9. Your Choices</h2>
        <p className="text-muted-foreground">
          Depending on the Service's available features, you may be able to:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Review or update account information</li>
          <li>Change household permissions</li>
          <li>Remove household members</li>
          <li>Disconnect third-party calendar integrations</li>
          <li>Delete calendar information</li>
          <li>Delete your account</li>
          <li>Request deletion or correction of certain personal information</li>
        </ul>
        <p className="text-muted-foreground">
          You may also revoke permissions granted to third-party services directly through those
          providers.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">10. Cookies and Similar Technologies</h2>
        <p className="text-muted-foreground">
          We may use cookies, local storage, and similar technologies that are necessary for
          authentication, security, preferences, and operation of the Service.
        </p>
        <p className="text-muted-foreground">
          If we introduce advertising, nonessential tracking, or additional analytics technologies in
          the future, this Privacy Policy may be updated accordingly.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">11. Business Transfers</h2>
        <p className="text-muted-foreground">
          If the Service or its assets are involved in a merger, acquisition, financing,
          reorganization, or sale, information may be transferred as part of that transaction,
          subject to applicable law.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">12. Changes to This Privacy Policy</h2>
        <p className="text-muted-foreground">
          We may update this Privacy Policy from time to time.
        </p>
        <p className="text-muted-foreground">
          When we make material changes, we may provide notice through the Service, by email, or by
          updating the effective date shown above.
        </p>
        <p className="text-muted-foreground">
          Continued use of the Service after an updated Privacy Policy becomes effective constitutes
          acknowledgment of the updated policy to the extent permitted by law.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">13. Contact Us</h2>
        <p className="text-muted-foreground">
          Questions or requests regarding this Privacy Policy or your personal information may be
          submitted through the contact information provided on the Our Family Calendar website.
        </p>
        <p className="font-semibold">Our Family Calendar</p>
        <p className="text-muted-foreground">ourfamilycalendar.com</p>
      </section>
    </LegalPageLayout>
  );
}
