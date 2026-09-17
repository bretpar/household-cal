# Google event title initials setting

## Scope
- Add one owner-only toggle under the existing Google Calendar sync settings.
- Store a household-level `include_google_event_initials` preference, defaulting to `true` for existing and new households.
- Preserve the current outbound title format when enabled; send the clean app title when disabled.
- Keep inbound generated-suffix stripping unchanged.

## Implementation
- Add the boolean column through a focused database migration.
- Return and update the preference through the existing Google sync settings functions and owner checks.
- On a preference change, mark that household's existing Google links for their normal in-place reconciliation; do not recreate events.
- Thread the preference only into the existing outbound Google title builder.
- Add focused tests for enabled/disabled title generation and run only the relevant test, type check, and build validation.
