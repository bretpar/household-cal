# Simplify household role selection

## Scope
- Keep Owner, Editor, and Viewer behavior unchanged.
- Treat Babysitter as a display choice backed by the existing Viewer role and caregiver profile.
- Do not change permissions, security policies, invitation acceptance, or database structure.

## Changes
- Add Babysitter to both invitation and existing-user role dropdowns.
- Continue sending babysitter invitations through the existing atomic restricted-access flow, including required family-member, calendar, and date visibility choices.
- Derive an existing user's displayed role from their caregiver profile: configured Viewers display as Babysitter.
- Open the existing caregiver configuration dialog when Babysitter is selected and remove the separate “Make babysitter” button.
- When a configured Babysitter changes to Viewer, show a short broader-access warning, then remove the caregiver profile through the existing supported action.
- Show pending caregiver invitations as Babysitter instead of Viewer.

## Validation
- Check the focused source changes and latest preview build status only; do not run QA.
