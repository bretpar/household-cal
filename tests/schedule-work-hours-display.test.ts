import { describe, expect, it } from "vitest";
import { compactWorkTime, workHourLines } from "@/lib/schedule-coverage";
import type { ParentWorkDay } from "@/lib/smart-coverage";

const day = (label: string, intervals: [number, number][], over: Partial<ParentWorkDay> = {}): ParentWorkDay =>
  ({ label, intervals, unavailable: false, manualReview: false, ...over });

describe("monthly grid parent work-hours lines", () => {
  it("shows a parent's scheduled work hours", () => {
    expect(workHourLines(day("Dad", [[480, 1020]]))).toEqual(["Dad · 8a–5p"]);
  });

  it("shows each parent's hours on its own line", () => {
    expect(workHourLines(day("Dad", [[480, 1020]]))).toEqual(["Dad · 8a–5p"]);
    expect(workHourLines(day("Mom", [[450, 900]]))).toEqual(["Mom · 7:30a–3p"]);
  });

  it("lists several work intervals on one day", () => {
    expect(workHourLines(day("Dad", [[540, 720], [1080, 1200]]))).toEqual(["Dad · 9a–12p, 6p–8p"]);
  });

  it("leaves the area empty when the parent has no work event", () => {
    expect(workHourLines(day("Dad", []))).toEqual([]);
  });

  it("never labels missing or ambiguous work data in the grid", () => {
    expect(workHourLines(day("Dad", [], { unavailable: true }))).toEqual([]);
    expect(workHourLines(day("Dad", [], { manualReview: true }))).toEqual([]);
    expect(workHourLines(day("Dad", [], { unavailable: true, manualReview: true }))).toEqual([]);
  });

  it("still shows real hours when the source is flagged incomplete elsewhere", () => {
    expect(workHourLines(day("Mom", [[450, 900]], { unavailable: true, manualReview: true }))).toEqual(["Mom · 7:30a–3p"]);
  });

  it("formats compact household times", () => {
    expect(compactWorkTime(0)).toBe("12a");
    expect(compactWorkTime(450)).toBe("7:30a");
    expect(compactWorkTime(480)).toBe("8a");
    expect(compactWorkTime(930)).toBe("3:30p");
    expect(compactWorkTime(1020)).toBe("5p");
    expect(compactWorkTime(1200)).toBe("8p");
  });
});
