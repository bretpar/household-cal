import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { transpileModule } from "typescript";
import { MEMBER_COLORS } from "../src/lib/family-data";

const source = readFileSync(new URL("../src/routes/_authenticated/onboarding.tsx", import.meta.url), "utf8");
const start = source.indexOf("let rowSeq = 0;");
const end = source.indexOf("const STEPS", start);
const { outputText } = transpileModule(source.slice(start, end), {});
const newRow = runInNewContext(`${outputText}\nnewRow`, { MEMBER_COLORS }) as (
  overrides: Record<string, unknown>, usedColors: string[],
) => { color: string };

describe("onboarding member color defaults", () => {
  it("uses the first unused palette color", () => {
    expect(newRow({}, ["sky", "rose"]).color).toBe("amber");
  });

  it("cycles through the existing palette once all colors are used", () => {
    expect(newRow({}, [...MEMBER_COLORS]).color).toBe("sky");
    expect(newRow({}, [...MEMBER_COLORS, "sky"]).color).toBe("rose");
  });

  it("preserves explicitly supplied member colors", () => {
    expect(newRow({ color: "coral" }, ["sky", "coral"]).color).toBe("coral");
  });
});