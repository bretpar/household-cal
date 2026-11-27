import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email-templates/send-email", () => ({ sendTemplateEmail: vi.fn() }));

import { sendTemplateEmail } from "@/lib/email-templates/send-email";
import { sendHouseholdInvitationEmail } from "@/lib/household-email.server";

const sendMock = vi.mocked(sendTemplateEmail);

function fixture(responses: { data: unknown; error: unknown }[]) {
  const invite = {
    id: "invite-1",
    email: "Person@example.com",
    role: "viewer",
    token: "token-1",
    family_id: "family-1",
    invited_by: "owner-1",
    families: { name: "Parker Family" },
  };
  const rpc = vi.fn(async () => responses.shift() ?? { data: true, error: null });
  const admin = {
    from(table: string) {
      expect(table).toBe("family_invitations");
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: invite, error: null }) }),
        }),
      };
    },
    rpc,
  };
  return { admin, rpc };
}

describe("household invitation email delivery limits", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ sent: true });
  });

  it("allows ordinary delivery with 20 sender emails hourly and 3 recipient emails daily", async () => {
    const f = fixture([]);
    await expect(sendHouseholdInvitationEmail(f.admin, "invite-1")).resolves.toEqual({ emailed: true });
    expect(f.rpc).toHaveBeenNthCalledWith(1, "consume_auth_lookup", {
      _bucket: "household-invitation-sender:owner-1",
      _max: 20,
      _window_seconds: 3600,
    });
    const recipientCall = f.rpc.mock.calls[1];
    expect(recipientCall?.[0]).toBe("consume_auth_lookup");
    expect(recipientCall?.[1]).toMatchObject({ _max: 3, _window_seconds: 86400 });
    expect(recipientCall?.[1]["_bucket"]).toMatch(/^household-invitation-recipient:[a-f0-9]{64}$/);
    expect(recipientCall?.[1]["_bucket"]).not.toContain("Person@example.com");
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it("does not send when the recipient limit is exhausted", async () => {
    const f = fixture([
      { data: true, error: null },
      { data: false, error: null },
    ]);
    await expect(sendHouseholdInvitationEmail(f.admin, "invite-1")).resolves.toEqual({ emailed: false });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("fails closed when delivery-limit state cannot be checked", async () => {
    const f = fixture([{ data: null, error: new Error("unavailable") }]);
    await expect(sendHouseholdInvitationEmail(f.admin, "invite-1")).resolves.toEqual({ emailed: false });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
