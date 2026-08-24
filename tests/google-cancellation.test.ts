import { describe, expect, it } from "vitest";

import { cancellationAction, shouldApplyGoogleChange } from "../src/lib/google/mapping";

const link = { calendar_source_id: "src-1", google_event_id: "g-1" };

describe("cancellationAction", () => {
  it("ignores a tombstone when Google still has the event live", () => {
    expect(
      cancellationAction({ link, sourceId: "src-1", googleEventId: "g-1", remoteState: "live" }),
    ).toBe("ignore");
  });

  it("ignores a tombstone from a different connected calendar", () => {
    expect(
      cancellationAction({
        link,
        sourceId: "src-2",
        googleEventId: "g-1",
        remoteState: "missing",
      }),
    ).toBe("ignore");
  });

  it("ignores a tombstone for an unrelated Google event id", () => {
    expect(
      cancellationAction({
        link,
        sourceId: "src-1",
        googleEventId: "g-other",
        remoteState: "missing",
      }),
    ).toBe("ignore");
  });

  it("ignores a tombstone when verification failed", () => {
    expect(
      cancellationAction({ link, sourceId: "src-1", googleEventId: "g-1", remoteState: "unknown" }),
    ).toBe("ignore");
  });

  it("ignores a tombstone with no link at all (full-pull omission is not a delete)", () => {
    expect(
      cancellationAction({
        link: null,
        sourceId: "src-1",
        googleEventId: "g-1",
        remoteState: "missing",
      }),
    ).toBe("ignore");
  });

  it("removes when Google confirms the linked event is cancelled", () => {
    expect(
      cancellationAction({
        link,
        sourceId: "src-1",
        googleEventId: "g-1",
        remoteState: "cancelled",
      }),
    ).toBe("remove");
  });

  it("removes when Google confirms the linked event is gone", () => {
    expect(
      cancellationAction({ link, sourceId: "src-1", googleEventId: "g-1", remoteState: "missing" }),
    ).toBe("remove");
  });

  it("keeps the inbound time-edit conflict fix untouched", () => {
    expect(
      shouldApplyGoogleChange(
        {
          google_etag: '"old"',
          google_updated_at: "2026-08-24T10:00:00Z",
          last_source: "app",
          last_pushed_at: "2026-08-24T10:00:05Z",
        },
        { etag: '"new"', updated: "2026-08-24T11:00:00Z" },
        { updated_at: "2026-08-24T10:00:05Z", last_change_source: "app" },
      ),
    ).toBe(true);
  });
});
