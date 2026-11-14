import { describe, expect, it } from "vitest";
import { createVersionChain, publishErrorReason } from "@/lib/schedule-publish.server";
import { orphanStatus, proposalNeedsReview, proposalOrphaned, type ExistingShift, type ProposedShift } from "@/lib/schedule-builder";

const SERIES = "6248ccfb-a2c7-4805-a573-8939e7fa94df";
const REVIEWED = "2026-11-11T05:03:04.228+00:00";

/** Fake of the publish RPC's transactional rule: the expected version must equal the
 * event's current version; each committed step advances it. */
function fakeCalendar() {
  const events = new Map<string, { version: string; excluded: string[] }>([[SERIES, { version: REVIEWED, excluded: [] }]]);
  const applied = new Set<string>();
  let tick = 0;
  return {
    events,
    externalEdit() { events.get(SERIES)!.version = `external-${++tick}`; },
    apply(opKey: string, kind: "update" | "exclude", date: string, expected: string | null) {
      if (applied.has(opKey)) return { outcome: "already_applied", series_version: events.get(SERIES)!.version };
      const e = events.get(SERIES)!;
      if (expected !== e.version) throw { code: "P0001", message: "This event changed since the plan was reviewed. Reload the preview before publishing." };
      if (e.excluded.includes(date)) throw { code: "P0001", message: "That occurrence is already excluded from the series." };
      e.excluded.push(date);
      e.version = `run-${++tick}`;
      applied.add(opKey);
      return { outcome: kind === "update" ? "applied" : "applied", series_version: e.version };
    },
  };
}

function publish(cal: ReturnType<typeof fakeCalendar>, ops: { key: string; kind: "update" | "exclude"; date: string }[], between?: (i: number) => void) {
  const chain = createVersionChain({ [SERIES]: REVIEWED });
  const out = { applied: 0, skipped: 0, failed: [] as string[] };
  ops.forEach((op, i) => {
    between?.(i);
    try {
      const r = cal.apply(op.key, op.kind, op.date, chain.expected(SERIES));
      chain.advance(SERIES, r.series_version);
      if (r.outcome === "already_applied") out.skipped += 1; else out.applied += 1;
    } catch (e) { out.failed.push(publishErrorReason(e)); }
  });
  return out;
}

const december = [
  { key: "a", kind: "update" as const, date: "2026-12-10" },
  { key: "b", kind: "update" as const, date: "2026-12-14" },
  { key: "c", kind: "update" as const, date: "2026-12-17" },
  { key: "d", kind: "update" as const, date: "2026-12-21" },
];

describe("publishing several changes to one recurring series", () => {
  it("applies every change in one run", () => {
    const cal = fakeCalendar();
    expect(publish(cal, december)).toEqual({ applied: 4, skipped: 0, failed: [] });
  });

  it("applies a mix of time edits, a date move and an occurrence removal", () => {
    const cal = fakeCalendar();
    const r = publish(cal, [...december.slice(0, 2), { key: "rm", kind: "exclude", date: "2026-12-15" }, december[2]]);
    expect(r.applied).toBe(4);
    expect(cal.events.get(SERIES)!.excluded.sort()).toEqual(["2026-12-10", "2026-12-14", "2026-12-15", "2026-12-17"]);
  });

  it("still blocks a genuine external change made during publication", () => {
    const cal = fakeCalendar();
    const r = publish(cal, december, (i) => { if (i === 2) cal.externalEdit(); });
    expect(r.applied).toBe(2);
    expect(r.failed).toHaveLength(2);
    expect(r.failed[0]).toMatch(/changed since the plan was reviewed/);
  });

  it("repeating the publication never applies a step twice or removes more occurrences", () => {
    const cal = fakeCalendar();
    publish(cal, december);
    const again = publish(cal, december);
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(4);
    expect(cal.events.get(SERIES)!.excluded).toHaveLength(4);
  });

  it("ignores versions for events the review never covered", () => {
    const chain = createVersionChain({ [SERIES]: REVIEWED });
    chain.advance("other", "x");
    expect(chain.expected("other")).toBeNull();
  });
});

describe("publish error reasons", () => {
  it("shows intentional owner-facing database messages", () => {
    expect(publishErrorReason({ code: "P0001", message: "That occurrence is already excluded from the series." }))
      .toBe("That occurrence is already excluded from the series.");
  });
  it("hides internal database details", () => {
    const r = publishErrorReason({ code: "23505", message: 'duplicate key value violates unique constraint "x_pkey"' });
    expect(r).not.toMatch(/constraint|pkey/);
    expect(r).toMatch(/Refresh Review/);
  });
  it("never reports the bare generic message", () => {
    expect(publishErrorReason(undefined)).not.toBe("Publish step failed");
  });
});

describe("monthly grid after a partial publication", () => {
  const replacement: ExistingShift = {
    key: "bf5a-2026-12-08T15:30:00.000Z", eventId: "bf5a3717-f884-41bd-a516-66c43652ded0", date: "2026-12-08",
    title: "Michelle", start: "07:30", end: "17:00", allDay: false,
    assignment: { kind: "caregiver", family_member_id: "2d4871f0-0000-4000-8000-000000000000" },
    startAt: "2026-12-08T15:30:00.000Z", endDate: "2026-12-08", splitFromEventId: SERIES, splitFromDate: "2026-12-10",
  };
  const moved: ProposedShift = {
    id: "8c231366-ee00-4d2b-915a-f6863d5c9467", date: "2026-12-08", start: "07:30", end: "17:00", title: "Michelle",
    assignment: replacement.assignment,
    existing: { eventId: SERIES, occurrenceKey: `${SERIES}-2026-12-10T15:30:00.000Z`, startAt: "2026-12-10T15:30:00.000Z", splitFromEventId: null, splitFromDate: null },
  };
  const published = { [moved.id]: replacement.eventId };

  it("recognizes the already-published replacement: no false orphan or overlap", () => {
    expect(proposalOrphaned(moved, [replacement], published)).toBe(false);
    expect(orphanStatus(moved, [replacement], {}, [], "2026-12", published)).toBeNull();
    expect(proposalNeedsReview(moved, [replacement], [moved], published)).toBe(false);
  });

  it("keeps real orphan and overlap protection without a published mapping", () => {
    expect(proposalOrphaned(moved, [])).toBe(true);
    const other = { ...replacement, key: "x", eventId: "99999999-9999-4999-8999-999999999999", splitFromEventId: null, splitFromDate: null };
    expect(proposalNeedsReview(moved, [replacement, other], [moved], published)).toBe(true);
  });
});
