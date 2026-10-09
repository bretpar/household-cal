import { describe, expect, it } from "vitest";

import {
  eventDestinationId,
  draftFromFormState,
  validateFormState,
  type EventFormState,
} from "@/components/EventForm";

const BABYSITTER_CALENDAR = "calendar-babysitter";
const FAMILY_CALENDAR = "calendar-family";
const CAREGIVER = "member-caregiver";

function state(over: Partial<EventFormState> = {}): EventFormState {
  return {
    title: "School run",
    date: "2026-10-12",
    endDate: "2026-10-12",
    startTime: "08:00",
    endTime: "08:30",
    allDay: false,
    members: [],
    eventType: "activity",
    categoryId: null,
    recurrence: "none",
    recurrenceEnd: "never",
    recurrenceUntil: "",
    recurrenceCount: 10,
    weeklyDays: [],
    customizeDays: false,
    memberWeekdays: {},
    location: "",
    notes: "",
    calendarSourceId: FAMILY_CALENDAR,
    babysitter: undefined,
    ...over,
  };
}

const context = {
  babysitterCalendarSourceId: BABYSITTER_CALENDAR,
  fallbackCalendarSourceId: FAMILY_CALENDAR,
};

describe("event member validation", () => {
  it("keeps requiring a family member on a regular family calendar", () => {
    expect(validateFormState(state(), context)).toBe("Choose at least one family member");
  });

  it("still requires a family member off the Babysitter calendar even with a caregiver set", () => {
    expect(
      validateFormState(
        state({ babysitter: { kind: "caregiver", family_member_id: CAREGIVER } }),
        context,
      ),
    ).toBe("Choose at least one family member");
  });

  it("lets a Babysitter calendar event save with an assigned caregiver and no family members", () => {
    expect(
      validateFormState(
        state({
          calendarSourceId: BABYSITTER_CALENDAR,
          babysitter: { kind: "caregiver", family_member_id: CAREGIVER },
        }),
        context,
      ),
    ).toBeNull();
  });

  it("applies the same rule when editing, where the destination comes from the event", () => {
    expect(
      validateFormState(
        state({
          calendarSourceId: null,
          babysitter: { kind: "caregiver", family_member_id: CAREGIVER },
        }),
        { ...context, fallbackCalendarSourceId: BABYSITTER_CALENDAR },
      ),
    ).toBeNull();
    expect(eventDestinationId(state({ calendarSourceId: null }), BABYSITTER_CALENDAR)).toBe(
      BABYSITTER_CALENDAR,
    );
  });

  it("accepts a named sitter who has no household record", () => {
    expect(
      validateFormState(
        state({
          calendarSourceId: BABYSITTER_CALENDAR,
          babysitter: { kind: "other", name: "Ana" },
        }),
        context,
      ),
    ).toBeNull();
  });

  it("still asks who is babysitting before a day can be left to nobody", () => {
    expect(
      validateFormState(
        state({ calendarSourceId: BABYSITTER_CALENDAR, babysitter: null }),
        context,
      ),
    ).toBe("Choose the assigned babysitter");
    expect(
      validateFormState(
        state({ calendarSourceId: BABYSITTER_CALENDAR, babysitter: { kind: "none" } }),
        context,
      ),
    ).toBe("Choose the assigned babysitter");
  });

  it("keeps childcare optional", () => {
    expect(validateFormState(state({ eventType: "childcare" }), context)).toBeNull();
  });

  it("requires an assignment even with selected members or an all-day event", () => {
    expect(validateFormState(state({ calendarSourceId: BABYSITTER_CALENDAR, allDay: true, members: ["parent"] }), context)).toBe("Choose the assigned babysitter");
  });

  it("ignores a hidden empty caregiver assignment on other calendars", () => {
    expect(validateFormState(state({ members: ["parent"], babysitter: { kind: "other", name: "" } }), context)).toBeNull();
  });

  it("submits preserved caregiver values only to the Babysitter calendar", () => {
    const form = state({ members: ["parent"], babysitter: { kind: "caregiver", family_member_id: CAREGIVER } });
    expect(draftFromFormState(form, FAMILY_CALENDAR, BABYSITTER_CALENDAR)).not.toHaveProperty("babysitter_assignment");
    expect(draftFromFormState({ ...form, calendarSourceId: BABYSITTER_CALENDAR }, FAMILY_CALENDAR, BABYSITTER_CALENDAR).babysitter_assignment).toEqual(form.babysitter);
    expect(form.babysitter).toEqual({ kind: "caregiver", family_member_id: CAREGIVER });
  });
});
