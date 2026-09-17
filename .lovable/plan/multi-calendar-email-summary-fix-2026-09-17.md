# Multi-calendar email summary fix

## Change
- Include each event's connected-calendar links when loading summary data.
- Treat an event as selected when either its stored calendar or any linked calendar matches one of the recipient's selected calendar IDs.
- Add a focused regression test proving a direct Babysitter event and a Kids-linked event appear together.

## Preserve
- Recipient permissions, weekday filters, email layout, unsubscribe behavior, sync behavior, and all unrelated notification logic.
- No database or schema changes.
