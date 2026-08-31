# Fix the scheduled email summary dispatch (currently rejected as unauthorized)

## What the logs show

- The database scheduler job `email-summaries-dispatch` is active and firing every 5 minutes. Every run around Sunday Aug 30 18:00 America/Los_Angeles (Aug 31 01:00–01:25 UTC) completed successfully at the scheduler level.
- Every one of those HTTP calls came back **401 Unauthorized** with body `Unauthorized`. The same is true for the `google-calendar-reconcile` job.
- Because the request is rejected at the door, the dispatch code never ran: no schedules were loaded, "Parker Family Week Plans" and "Babysitter Test" were never evaluated, nothing was sent or skipped, and the email provider was never called (`email_summary_sends` is empty and there are no delivery events).

Both scheduled jobs send a hard-coded `Authorization: Bearer …` value that no longer matches the secret the endpoints accept. Secret values are not readable, so the fix is to re-align the two.

## Fix

1. Generate/confirm a single shared scheduler token and store it as the project secret the endpoints check (`GOOGLE_SYNC_SCHEDULER_TOKEN`).
2. Re-create both scheduler jobs (`email-summaries-dispatch`, `google-calendar-reconcile`) with that exact token in the `Authorization` header, keeping the current URLs and cadences (`*/5 * * * *` and `*/15 * * * *`). This is a settings-level statement, not a schema migration.
3. Verify: after the next runs, confirm HTTP 200 responses in the scheduler response log and a JSON body from the dispatch route.
4. Confirm behavior for the two enabled weekly 18:00 schedules on the next Sunday window — or, to avoid waiting, verify with one authorized manual call and inspect the returned per-schedule result (`not_due` is the expected answer outside the window).

## Notes / assumptions

- No code change is expected; the route's auth logic is correct, only the credential the scheduler presents is stale.
- Recipients are configured correctly: "Parker Family Week Plans" has 1 subscribed recipient with 2 calendars and no weekday restriction; "Babysitter Test" has 1 subscribed recipient with 1 calendar restricted to Mon/Wed/Thu (that recipient will legitimately be skipped for a Sunday weekly window).
- Reconciliation of Google calendars has also been failing for the same reason and is fixed by the same change.
