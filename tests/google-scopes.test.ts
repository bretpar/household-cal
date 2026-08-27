import { describe, expect, it } from "vitest";

import { GOOGLE_SCOPES } from "../src/lib/google/api.server";

describe("Google Calendar OAuth scopes", () => {
  it("requests exactly the three focused Calendar scopes and no userinfo scopes", () => {
    expect(GOOGLE_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.calendars",
    ]);
  });
});
