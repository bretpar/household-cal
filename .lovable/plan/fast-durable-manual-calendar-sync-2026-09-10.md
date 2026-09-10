# Fast, durable manual calendar sync

## Changes
- Add durable per-household manual-sync state to the existing Google connection record: running timestamp, completion timestamp, and a concise failure message.
- Add a database-side atomic lock operation so repeated taps acknowledge the existing run instead of launching overlapping reconciliation.
- Change `Sync now` to acquire that lock, schedule the unchanged reconciliation using the app runtime’s background mechanism, and return immediately once accepted.
- Ensure background completion and failure always persist a final state while preserving existing connection and calendar sync error behavior.
- Extend the existing lightweight sync-settings response with the durable run state.
- Update all three existing sync controls to show `Syncing…` immediately, poll only sync settings while running, refresh calendar data only after successful completion, and display specific accepted/start/failure messages instead of raw browser errors.

## Scope
- No changes to Google pull, reconcile, push, recurrence, connection, scheduler, permissions, or household isolation semantics.
- No visual redesign and no browser QA or broad tests.

## Technical details
- The lock expires after a conservative timeout so interrupted workers cannot leave a household permanently stuck.
- Starting and completing runs use an attempt identifier, preventing an old run from overwriting a newer run’s durable state.
