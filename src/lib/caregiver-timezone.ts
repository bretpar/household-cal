import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

/** Real instants with workspace-local getters; never shifted fake timestamps. */
export const workDate = (value: Date | string | number, timezone: string) => new TZDate(new Date(value).getTime(), timezone);
export const workInput = (value: string, timezone: string) => formatInTimeZone(value, timezone, "yyyy-MM-dd'T'HH:mm");
export function workInputInstant(value: string, timezone: string) {
  const instant = fromZonedTime(value, timezone);
  if (!Number.isFinite(instant.getTime()) || formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm") !== value) {
    throw new Error("Choose a valid time in your work time zone. This time may not exist during a daylight-saving change.");
  }
  return instant.toISOString();
}
export const workDateInput = (value: Date) => format(value, "yyyy-MM-dd'T'HH:mm");