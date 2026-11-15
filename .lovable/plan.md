# Phase 1: Independent caregiver accounts

## Account and navigation
- Reuse existing authentication and profile information; no new profile fields.
- Offer “I’m a Parent / Family” and “I’m a Babysitter / Caregiver” only during new-account setup. Existing household members and invited caregivers keep their current experience.
- Give independent caregivers Today, Calendar, Timesheets and Settings tabs within the existing app, including native iPhone presentation.

## Private contacts and shifts
- Add caregiver-owned family/client contacts with a required name, optional email and calendar color. Contacts are not OFC households and grant no household access.
- Support creating, editing and deleting personal shifts, each linked to exactly one owned contact, with start/end times and optional notes.
- Reuse existing calendar rendering, date utilities and colors through a personal-calendar adapter rather than creating another calendar engine.
- Today shows upcoming shifts and scheduled hours. Timesheets shows scheduled hours only; actual hours, approvals and finalized household timesheets remain untouched.

## Personal Google Calendar
- Reuse the existing Google consent flow, encrypted credential handling, API utilities and delivery verification where safe.
- Let caregivers select a writable Google calendar for their shifts. OFC remains authoritative; personal shifts do not become household events or import arbitrary Google events as client-assigned shifts.
- Persist personal synchronization identities and retryable operations separately, with stable create identities, update/delete handling and pending/error status. Integrate processing with the existing scheduler without changing household synchronization behavior.
- Preserve credentials and connection ownership when one account also has household membership; never overwrite a household connection with a personal connection.

## Technical boundaries and safeguards
- Add an independent-workspace record keyed by the authenticated user, private client records, personal shifts, and server-only connection/delivery records as needed. Use additive migrations with explicit grants and owner-scoped RLS; keep privileged credentials inaccessible to browser reads.
- Enforce contact ownership and exactly-one-contact shift association in the database as well as server validation. Keep contact removal from silently deleting shift history.
- Separate account/workspace choice from existing household roles. Selecting caregiver onboarding does not change Owner, Editor, Viewer or invited-caregiver permissions.
- Scope personal queries and caches to the verified user; preserve current household cache boundaries and native startup behavior.
- Use authenticated server functions and document new architecture rules in AGENTS.md.

## Review and exclusions
- No abandoned Work Mode commit recovery, household linking, invitations, PDF/email timesheets, payments, payroll or separate mobile app.
- No QA runs, browser verification, test suites or automatic deployment, as requested. Inspect automatic compilation feedback only; report runtime flows as unverified.
- Report implemented features, database changes, signup/shift/Google limitations, remaining Phase 2 work and commit.