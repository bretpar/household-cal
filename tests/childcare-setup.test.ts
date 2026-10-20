import { describe, expect, it, vi } from "vitest";
import { confirmChildcareSetup } from "../src/lib/childcare-setup";

function actions() {
  return {
    create: vi.fn(async (_name: string) => ({ id: "childcare-source" })),
    isGoogle: vi.fn(async (_id: string) => false),
    linkGoogle: vi.fn(async (_id: string, _name: string) => undefined),
    select: vi.fn(async (_id: string) => undefined),
  };
}

describe("childcare destination confirmation", () => {
  it("defaults an optional blank OFC name to Babysitter", async () => {
    const a = actions();
    await confirmChildcareSetup({ destination: "ofc", name: " ", calendarId: null }, a);
    expect(a.create).toHaveBeenCalledWith("Babysitter");
    expect(a.linkGoogle).not.toHaveBeenCalled();
  });
  it("links the dedicated source to a new Google calendar with the chosen name", async () => {
    const a = actions();
    await confirmChildcareSetup({ destination: "google", name: " Nanny schedule ", calendarId: null }, a);
    expect(a.linkGoogle).toHaveBeenCalledWith("childcare-source", "Nanny schedule");
  });
  it("does not create another Google calendar when the source is already linked", async () => {
    const a = actions();
    a.isGoogle.mockResolvedValue(true);
    await confirmChildcareSetup({ destination: "google", name: "Babysitter", calendarId: null }, a);
    expect(a.linkGoogle).not.toHaveBeenCalled();
  });
  it("selects an existing destination without creating or converting calendars", async () => {
    const a = actions();
    await confirmChildcareSetup({ destination: "existing", name: "Babysitter", calendarId: "existing-google" }, a);
    expect(a.select).toHaveBeenCalledWith("existing-google");
    expect(a.create).not.toHaveBeenCalled();
    expect(a.linkGoogle).not.toHaveBeenCalled();
  });
});