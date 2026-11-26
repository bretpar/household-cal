import { describe, expect, it, vi } from "vitest";
import { authorizeQaCaller, resetQaHousehold, type AdminDb } from "../src/lib/qa-reset.server";

describe("disabled privileged QA reset", () => {
  for (const email of ["brendantparker+dad@gmail.com", "brendantparker+mom@gmail.com", "brendantparker+babysitter@gmail.com"]) {
    it(`never authorizes an account merely holding ${email}`, async () => {
      const listUsers = vi.fn(async () => ({ data: { users: [{ id: "recreated-user-id", email }] } }));
      const from = vi.fn(() => { throw new Error("No database access allowed"); });
      const admin = { from, auth: { admin: { listUsers } } } as AdminDb;
      expect(await authorizeQaCaller(admin, "recreated-user-id")).toMatchObject({ authorized: false, email: null });
      await expect(resetQaHousehold(admin, "recreated-user-id")).rejects.toThrow("QA reset is not available");
      expect(listUsers).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
    });
  }
});