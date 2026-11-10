import { describe, expect, it } from "vitest";
import { deliveryRemoteId, remoteMatchesDelivery, uniqueLegacyBranch } from "../src/lib/google/delivery";
import { claimCreateIntent, finishBranchDeletion } from "../src/lib/google/outbox.server";

const body = {
  summary: "Shift", description: "", location: "",
  start: { dateTime: "2026-11-10T09:00:00-08:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-11-10T17:00:00-08:00", timeZone: "America/Los_Angeles" },
  recurrence: null,
  extendedProperties: { private: { ofc_event_id: "event", ofc_family_id: "family", ofc_branch_key: "MO", ofc_source_id: "source" } },
};
const remote = { ...body, id: "remote", status: "confirmed" };

describe("exact Google delivery acknowledgment", () => {
  it("uses the restoration lease for deletion and withholds reversed-operation acknowledgment", async () => {
    const calls: { name: string; args: any }[] = [];
    const claim = { state: "claimed" as const, id: "id", version: "version", token: "token" };
    const admin = { from: () => { throw new Error("Unexpected write"); }, rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return { data: name === "claim_google_delivery" ? claim : false, error: null };
    } };
    const identity = { eventId: "event", branchKey: "MO", calendarSourceId: "source", externalCalendarId: "calendar", body: {} };
    await claimCreateIntent(admin, "family", identity);
    await claimCreateIntent(admin, "family", { ...identity, deleting: true });
    expect(calls[0]?.args._key).toBe("delivery:event:source:MO");
    expect(calls[1]?.args._key).toBe(calls[0]?.args._key);
    expect(calls[1]?.args._payload.deleting).toBe(true);
    await expect(finishBranchDeletion(admin, "family", "delivery:event:source:MO", claim, "remote")).rejects.toThrow("acknowledgment withheld");
    expect(calls[2]?.args._version).toBe("version");
    expect(calls[2]?.args._token).toBe("token");
  });
  it("adopts a unique legacy ownership/recurrence match without comparing title or times", () => {
    const legacy = { ...remote, summary: "Old title", extendedProperties: { private: { ofc_event_id: "event", ofc_family_id: "family" } } };
    expect(uniqueLegacyBranch([legacy], body)).toBe("remote");
    expect(uniqueLegacyBranch([], body)).toBeNull();
    expect(() => uniqueLegacyBranch([legacy, { ...legacy, id: "duplicate" }], body)).toThrow();
    expect(() => uniqueLegacyBranch([{ ...legacy, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] }], body)).toThrow();
    expect(() => uniqueLegacyBranch([{ ...legacy, recurringEventId: "parent" }], body)).toThrow();
    expect(() => uniqueLegacyBranch([{ ...legacy, extendedProperties: { private: { ofc_event_id: "other", ofc_family_id: "family" } } }], body)).toThrow();
    expect(() => uniqueLegacyBranch([{ ...legacy, extendedProperties: { private: { ofc_event_id: "event", ofc_family_id: "other" } } }], body)).toThrow();
    expect(() => uniqueLegacyBranch([{ ...legacy, extendedProperties: { private: { ofc_event_id: "event", ofc_family_id: "family", ofc_source_id: "other" } } }], body)).toThrow();
  });
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