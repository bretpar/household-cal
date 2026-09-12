# Recurring email recipient eligibility

## Goal
Prevent scheduled family summaries from sending to people who have not completed household invite acceptance.

## Changes
- At scheduled-send time, load the household's accepted user memberships from the existing `family_users` records.
- Send daily, weekly, and monthly summaries only when the recipient's linked `user_id` belongs to that same household.
- Count ineligible or legacy unlinked recipients as skipped without changing their records, unsubscribe state, email content, schedules, or UI.

## Technical details
- Keep the change in `src/lib/email-summaries/dispatch.server.ts`, where all recurring frequencies share one dispatch path.
- Add a focused test for the eligibility predicate and run only that test plus a TypeScript check.
- No schema, invitation flow, permissions, or email-template changes.
