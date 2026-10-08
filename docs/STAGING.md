# Staging → Production

Production: ourfamilycalendar.com (this project, its own backend). Staging: a separate remixed project with its own backend.

## One-time setup (manual)
1. Remix this project in Lovable ("OFC Staging"). A remix gets its own new backend: schema/migrations copied, no users, data or secrets.
2. Publish the staging project; optionally connect `staging.ourfamilycalendar.com` in its Domains settings.
3. In staging, add only staging secrets (separate Google OAuth client or staging redirect URLs; never reuse production tokens).
4. Google Cloud Console: add the staging URL's `/oauth/google-calendar/return` and sign-in redirect URLs. Do not remove or change production URLs.
5. Email: leave the staging email sender domain unverified/disabled and do not schedule the hourly timesheet / weekly summary jobs in staging. Test only with QA accounts.
6. Create QA accounts in staging (Dad/Mom/Babysitter).

## Each release
1. Make the change in this (production) project — do NOT publish.
2. Note the revision shown in Settings → Advanced / Maintenance → Build diagnostics in the preview (or the Git SHA on GitHub main).
3. Bring that same revision to staging (sync the staging repo/project from main at that SHA), publish staging.
4. Codex QA on staging; confirm staging Build diagnostics revision == approved SHA.
5. Publish production only if no newer edits landed since the approved SHA; confirm production revision == approved SHA.
