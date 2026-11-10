import { describe, expect, it } from "vitest";
import { snapshotEventVersions } from "@/lib/schedule-publish.server";

const op = (o: Record<string, unknown>) => ({ shiftId: "s", occurrenceKey: null, occurrenceDate: null, requiresReview: true, reason: null, ...o });
const plan = (ops: unknown[]) => ({ ops } as never);

describe("review snapshot versions", () => {
  it("uses the version from the same row that supplied details", () => {
    expect(snapshotEventVersions(plan([op({ kind: "update", eventId: "e1" })]), [{ id: "e1", updated_at: "v1" }], [])).toEqual({ e1: "v1" });
  });
  it("fails closed when a referenced event is missing from the snapshot", () => {
    expect(() => snapshotEventVersions(plan([op({ kind: "update", eventId: "e1" })]), [], [])).toThrow(/Refresh the review/);
  });
  it("fails closed when split lineage disagrees with the snapshot row", () => {
    expect(() => snapshotEventVersions(plan([op({ kind: "update", eventId: "e2" })]),
      [{ id: "e2", updated_at: "v", split_from_event_id: "p", split_from_date: "2026-11-03" }],
      [{ id: "e2", split_from_event_id: "p", split_from_date: "2026-11-04" }])).toThrow();
  });
  it("leaves orphaned conflicts as conflicts", () => {
    expect(snapshotEventVersions(plan([op({ kind: "conflict", eventId: "gone" })]), [], [])).toEqual({});
  });
});
