import { describe, expect, it } from "vitest";

import {
  computeBranches,
  missingBranchKeys,
  obsoleteBranchLinks,
} from "../src/lib/google/mapping";
import type { WeekdayCode } from "../src/lib/family-data";

const RULE = "FREQ=WEEKLY;BYDAY=MO,WE";

function keys(weekdays: Record<string, WeekdayCode[] | null>) {
  const ids = Object.keys(weekdays);
  return computeBranches({
    recurrence_rule: RULE,
    participants: ids.map((id) => ({ member_id: id, weekdays: weekdays[id]! })),
    member_ids: ids,
  }).map((b) => b.key);
}

function link(branch_key: string, id: string) {
  return { id, branch_key, google_recurring_event_id: null, google_original_start: null };
}

describe("branch link persistence repair", () => {
  const desired = keys({ dad: ["MO"], mom: ["WE"] });

  it("detects the missing second branch link after a cut-off push", () => {
    expect(desired).toEqual(["MO", "WE"]);
    expect(missingBranchKeys(desired, [link("MO", "dad-link")])).toEqual(["WE"]);
  });

  it("still repairs when another valid link already exists", () => {
    // one healthy link is not proof of a complete push
    const links = [link("MO", "dad-link")];
    expect(obsoleteBranchLinks(desired, links)).toEqual([]);
    expect(missingBranchKeys(desired, links).length).toBeGreaterThan(0);
  });

  it("is satisfied — and idempotent — once both links exist", () => {
    const links = [link("MO", "dad-link"), link("WE", "mom-link")];
    expect(missingBranchKeys(desired, links)).toEqual([]);
    expect(missingBranchKeys(desired, links)).toEqual([]);
  });

  it("ignores detached exception links when judging branch coverage", () => {
    const links = [
      link("MO", "dad-link"),
      link("WE", "mom-link"),
      {
        id: "exception-link",
        branch_key: "MO",
        google_recurring_event_id: "rec-1",
        google_original_start: "2026-09-07T16:00:00Z",
      },
    ];
    expect(missingBranchKeys(desired, links)).toEqual([]);
  });

  it("leaves exactly one shared series when converting back to shared", () => {
    const shared = keys({ dad: null, mom: null });
    expect(shared).toEqual([""]);
    const links = [link("MO", "dad-link"), link("WE", "mom-link")];
    expect(obsoleteBranchLinks(shared, links).map((l) => l.id)).toEqual([
      "dad-link",
      "mom-link",
    ]);
    expect(missingBranchKeys(shared, [])).toEqual([""]);
    expect(missingBranchKeys(shared, [link("", "shared-link")])).toEqual([]);
  });
});
