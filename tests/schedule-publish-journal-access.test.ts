import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("drizzle/migrations/0069_restrict_schedule_publish_journal_writes.sql", "utf8");

describe("schedule publish journal access", () => {
  it("removes direct client insert and update privileges", () => {
    expect(sql).toContain("REVOKE INSERT, UPDATE ON public.babysitter_schedule_publish_ops FROM authenticated;");
  });

  it("removes both client write policies while preserving the existing read policy", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Editors create publish ops"');
    expect(sql).toContain('DROP POLICY IF EXISTS "Editors update publish ops"');
    expect(sql).not.toContain("Editors read publish ops");
  });
});
