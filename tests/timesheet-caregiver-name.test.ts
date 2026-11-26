import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { name: "Alex", timesheets_enabled: true }, error: null }),
        }),
      }),
    }),
  },
}));

import { myCaregiver } from "../src/lib/timesheets.server";

describe("verified timesheet caregiver identity", () => {
  it("returns the authorized caregiver name for upcoming-period responses", async () => {
    const userDb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({ limit: async () => ({ data: [{ family_id: "family" }], error: null }) }),
          }),
        }),
      }),
      rpc: async () => ({ data: "member", error: null }),
    };
    await expect(myCaregiver(userDb, "user", "read")).resolves.toEqual({
      familyId: "family", memberId: "member", name: "Alex",
    });
  });
});
