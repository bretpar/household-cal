import { describe, it, expect } from "vitest";
import { historicalPlanViolations, type PublishPlan } from "@/lib/schedule-publish";

const op = (o: Partial<PublishPlan["ops"][number]>) => ({ shiftId: "s", kind: "update", eventId: "e", occurrenceKey: null, occurrenceDate: null, requiresReview: false, reason: null, ...o }) as PublishPlan["ops"][number];
const plan = (ops: PublishPlan["ops"]) => ({ ops } as unknown as PublishPlan);
const today = "2026-11-14";

describe("historical-date protection at publication", () => {
  it("rejects a stale reviewed deletion of a recurring occurrence that is now past", () => {
    expect(historicalPlanViolations(plan([op({ kind: "exclude", occurrenceDate: "2026-11-13" })]), [{ id: "s", date: "2026-11-13" }], today)).toEqual(["s"]);
  });
  it("rejects moving a past occurrence to a future date", () => {
    expect(historicalPlanViolations(plan([op({ occurrenceDate: "2026-11-13" })]), [{ id: "s", date: "2026-11-20" }], today)).toEqual(["s"]);
  });
  it("rejects a stale creation whose date has passed", () => {
    expect(historicalPlanViolations(plan([op({ kind: "create", eventId: null })]), [{ id: "s", date: "2026-11-13" }], today)).toEqual(["s"]);
  });
  it("allows today and future changes", () => {
    expect(historicalPlanViolations(plan([op({ kind: "create" }), op({ shiftId: "t", occurrenceDate: today })]), [{ id: "s", date: today }, { id: "t", date: "2026-11-20" }], today)).toEqual([]);
  });
});
