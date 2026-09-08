import { describe, expect, it } from "vitest";

import { computeBranches, obsoleteBranchLinks } from "../src/lib/google/mapping";
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

describe("shared <-> per-person branch representation changes", () => {
  it('drops the stale shared series when [""] becomes ["MO","WE"]', () => {
    const desired = keys({ dad: ["MO"], mom: ["WE"] });
    expect(desired).toEqual(["MO", "WE"]);
    const obsolete = obsoleteBranchLinks(desired, [link("", "shared-link")]);
    expect(obsolete.map((l) => l.id)).toEqual(["shared-link"]);
  });

  it('drops both branch series when ["MO","WE"] becomes [""]', () => {
    const desired = keys({ dad: null, mom: null });
    expect(desired).toEqual([""]);
    const obsolete = obsoleteBranchLinks(desired, [link("MO", "dad-link"), link("WE", "mom-link")]);
    expect(obsolete.map((l) => l.id)).toEqual(["dad-link", "mom-link"]);
  });

  it("keeps desired branches and is idempotent once converted", () => {
    const desired = keys({ dad: ["MO"], mom: ["WE"] });
    const links = [link("MO", "dad-link"), link("WE", "mom-link")];
    expect(obsoleteBranchLinks(desired, links)).toEqual([]);
    expect(obsoleteBranchLinks(desired, links)).toEqual([]);
  });

  it("never treats a detached exception link as an obsolete branch", () => {
    const obsolete = obsoleteBranchLinks([""], [
      {
        id: "exception-link",
        branch_key: "MO",
        google_recurring_event_id: "rec-1",
        google_original_start: "2026-09-07T16:00:00Z",
      },
    ]);
    expect(obsolete).toEqual([]);
  });
});
