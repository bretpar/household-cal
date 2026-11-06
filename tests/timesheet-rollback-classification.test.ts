import { describe, expect, it } from "vitest";

import { isDefinitelyRolledBackSqlstate } from "@/lib/calendar-ops";

// The recurring-split caller releases its Timesheet reconciliation hold only
// when the database certainly rolled the split back, so the classifier must
// never mark an unknown outcome as a rollback.
describe("recurring-split rollback classification", () => {
  it("keeps the hold for unknown-outcome SQLSTATEs", () => {
    // 40003 statement_completion_unknown / 08007 transaction_resolution_unknown
    expect(isDefinitelyRolledBackSqlstate("40003")).toBe(false);
    expect(isDefinitelyRolledBackSqlstate("08007")).toBe(false);
    // the rest of class 40 shares the same "cannot tell" semantics
    expect(isDefinitelyRolledBackSqlstate("40001")).toBe(false);
  });

  it("keeps the hold for connection, resource and system failures", () => {
    expect(isDefinitelyRolledBackSqlstate("08006")).toBe(false); // connection_failure
    expect(isDefinitelyRolledBackSqlstate("08003")).toBe(false); // connection_server_lost
    expect(isDefinitelyRolledBackSqlstate("53100")).toBe(false); // disk_full
    expect(isDefinitelyRolledBackSqlstate("57014")).toBe(false); // query_canceled
    expect(isDefinitelyRolledBackSqlstate("58030")).toBe(false); // unable_to_complete_connection_failure
  });

  it("keeps the hold for unrecognised or malformed codes", () => {
    expect(isDefinitelyRolledBackSqlstate("99999")).toBe(false);
    expect(isDefinitelyRolledBackSqlstate("2200")).toBe(false);
    expect(isDefinitelyRolledBackSqlstate("220077")).toBe(false);
    expect(isDefinitelyRolledBackSqlstate("2200a".toLowerCase())).toBe(false);
    expect(isDefinitelyRolledBackSqlstate(undefined)).toBe(false);
    expect(isDefinitelyRolledBackSqlstate(null)).toBe(false);
    expect(isDefinitelyRolledBackSqlstate(22007)).toBe(false);
    expect(isDefinitelyRolledBackSqlstate({})).toBe(false);
  });

  it("marks server-reported aborts as definite rollbacks", () => {
    expect(isDefinitelyRolledBackSqlstate("22007")).toBe(true); // invalid_datetime_format
    expect(isDefinitelyRolledBackSqlstate("23505")).toBe(true); // unique_violation
    expect(isDefinitelyRolledBackSqlstate("25006")).toBe(true); // read_only_sql_transaction
    expect(isDefinitelyRolledBackSqlstate("42703")).toBe(true); // undefined_column
    expect(isDefinitelyRolledBackSqlstate("42501")).toBe(true); // insufficient_privilege
    expect(isDefinitelyRolledBackSqlstate("P0001")).toBe(true); // raise_exception from the RPC's guards
    expect(isDefinitelyRolledBackSqlstate("0A000")).toBe(true); // feature_not_supported
  });
});
