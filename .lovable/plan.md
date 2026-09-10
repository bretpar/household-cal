# Durable manual Google sync execution

## Changes
- Add a protected manual-sync callback beside the existing scheduled Google reconciliation endpoint. The callback will await the accepted run, so the hosting runtime keeps it alive until completion.
- After the existing per-household lock is accepted, enqueue that callback through the database’s existing durable HTTP scheduler mechanism and return the fast acknowledgment as soon as enqueueing succeeds.
- Keep the existing reconciliation, pull, push, repair, authentication, and duplicate-lock behavior unchanged.
- If enqueueing fails, release only the matching attempt and return the existing concise start error.
- Make manual-run cleanup unconditional, preserve attempt matching, store a specific failure message, and log acceptance, callback start, completion/failure, release attempt, and affected-row count.

## Technical details
- Reuse the existing scheduler credential and server-to-server authentication.
- The callback body contains only the household ID, attempt ID, and initial-sync flag required by the worker.
- The existing status polling remains unchanged; successful reconciliation continues to set the connection’s last successful sync through its current completion path.
- No UI redesign, browser QA, or broad tests.
