import { describe, expect, it } from "vitest";
import { deliveryRemoteId, remoteMatchesDelivery } from "../src/lib/google/delivery";

const body = {
  summary: "Shift", description: "", location: "",
  start: { dateTime: "2026-11-10T09:00:00-08:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-11-10T17:00:00-08:00", timeZone: "America/Los_Angeles" },
  recurrence: null,
  extendedProperties: { private: { ofc_event_id: "event", ofc_family_id: "family", ofc_branch_key: "MO", ofc_source_id: "source" } },
};
const remote = { ...body, id: "remote", status: "confirmed" };

describe("exact Google delivery acknowledgment", () => {
  it("accepts only the intended live identity and current body", () => {
    expect(remoteMatchesDelivery(remote, body, "remote")).toBe(true);
    expect(remoteMatchesDelivery({ ...remote, summary: "Old title" }, body, "remote")).toBe(false);
  });
  it("never acknowledges cancelled live-event delivery", () => {
    expect(remoteMatchesDelivery({ ...remote, status: "cancelled" }, body, "remote")).toBe(false);
  });
  it.each(["ofc_event_id", "ofc_family_id", "ofc_branch_key", "ofc_source_id"])("rejects wrong %s", (key) => {
    expect(remoteMatchesDelivery({ ...remote, extendedProperties: { private: { ...body.extendedProperties.private, [key]: "other" } } }, body, "remote")).toBe(false);
  });
  it("rejects wrong remote id, times and recurrence exclusions", () => {
    expect(remoteMatchesDelivery(remote, body, "other")).toBe(false);
    expect(remoteMatchesDelivery({ ...remote, end: body.start }, body, "remote")).toBe(false);
    expect(remoteMatchesDelivery({ ...remote, recurrence: ["EXDATE:20261110"] }, body, "remote")).toBe(false);
  });
  it("fences repeated uncertain creates with the same deterministic Google id", async () => {
    const first = await deliveryRemoteId("family:event:source:branch:first");
    expect(await deliveryRemoteId("family:event:source:branch:first")).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await deliveryRemoteId("family:event:other-source:branch:first")).not.toBe(first);
  });
});