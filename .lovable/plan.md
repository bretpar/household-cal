# Household account status indicators

## Goal
Help household owners distinguish accepted household users from invitations that are still awaiting account setup.

## Changes
- Extend the existing household-access response with an account-status value derived only from current `family_users` memberships and `family_invitations` acceptance records.
- Show a compact green circled check beside accepted household users.
- Show a subtle pending icon beside outstanding invitations.
- Keep indicators owner-focused, with accessible labels/tooltips and no role, permission, email, or invitation-flow changes.

## Technical details
- Update `src/lib/household.server.ts` to expose the derived status without adding tables or changing the database schema.
- Update `src/components/HouseholdAccess.tsx` to render the icons in the existing user and invitation lists.
- Run only a focused TypeScript check and confirm the preview build remains healthy; no broad QA or regression suite.
