import { describe, expect, it } from "vitest";
import { planPublish } from "@/lib/schedule-publish";
import { originalVerified, plannedHours, reviewReadiness } from "@/lib/schedule-review";
import type { ExistingShift, ProposedShift } from "@/lib/schedule-builder";

const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const EV = "55555555-5555-4555-8555-555555555555";
const none = { kind: "none" as const };
const existing: ExistingShift = { key: `${EV}:k`, eventId: EV, date: "2026-11-10", title: "Sitter", start: "09:00", end: "13:00",
  allDay: false, assignment: none, startAt: "2026-11-10T17:00:00.000Z", endDate: "2026-11-10", splitFromEventId: null, splitFromDate: null };
const modified: ProposedShift = { id: A, date: "2026-11-10", start: "10:00", end: "14:00", title: "Sitter", assignment: none,
  existing: { eventId: EV, occurrenceKey: existing.key, startAt: existing.startAt, splitFromEventId: null, splitFromDate: null } } as ProposedShift;
const templateConflict: ProposedShift = { id: B, date: "2026-11-10", start: "15:00", end: "18:00", title: "Sitter", assignment: none } as ProposedShift;

describe("template conflicts block readiness", () => {
  const draft = { shifts: [modified, templateConflict] };
  const plan = planPublish(draft, [existing]);
  it("classifies an unreferenced mismatching proposal as a conflict, not a create", () => {
    expect(plan.ops.find((o) => o.shiftId === B)?.kind).toBe("conflict");
    expect(plan.counts.create).toBe(0);
  });
  it("confirming the unrelated modification keeps it blocked and excludes conflict hours", () => {
    plan.ops.forEach((o) => { if (o.original) o.original.eventVersion = "v1"; });
    const r = reviewReadiness(plan, new Set([A]), false);
    expect(r.ready).toBe(false);
    expect(r.conflictCount).toBe(1);
    expect(plannedHours(plan, draft)).toBe(4);
  });
});

describe("authoritative original details", () => {
  it("carries the server original and blocks when its version is missing", () => {
    const plan = planPublish({ shifts: [modified] }, [existing]);
    const op = plan.ops[0];
    expect(op.original?.start).toBe("09:00");
    expect(originalVerified(op)).toBe(false);
    expect(reviewReadiness(plan, new Set([A]), false).ready).toBe(false);
    op.original!.eventVersion = "v1";
    expect(reviewReadiness(plan, new Set([A]), false).ready).toBe(true);
  });
});
