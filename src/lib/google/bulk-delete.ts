export interface BulkDeleteFilters {
  source_id: string;
  title: string;
  start_date: string;
  /** `null` means "all future matching events" from `start_date` onward. */
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
}

export type RecurrenceStatus = "standalone" | "detached" | "healthy_recurring";

export interface BulkDeleteComparableEvent {
  id: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
}

export interface BulkDeletePreviewItem {
  key: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  calendar_name: string;
  exists_in: "Google" | "OFC" | "Both";
  recurrence_status: RecurrenceStatus;
  eligible: boolean;
  reason: string | null;
  google_event_ids: string[];
  ofc_event_id: string | null;
}

/** Stable destructive payload copied from an eligible preview row. */
export interface BulkDeleteTarget {
  key: string;
  title: string;
  date: string;
  google_event_ids: string[];
  ofc_event_id: string | null;
}

function validGeneratedInitialSuffix(suffix: string, initials: string[]): boolean {
  const allowed = new Set(initials.map((initial) => initial.trim().toUpperCase()).filter(Boolean));
  const parts = suffix.split(" & ").map((part) => part.trim().toUpperCase());
  return parts.length > 0 && parts.every((part) => allowed.has(part));
}

/** Exact title matching, while accepting only the app's known generated initials suffix. */
export function titleMatchesFilter(title: string, filter: string, initials: string[]): boolean {
  const actual = title.trim();
  const expected = filter.trim();
  if (actual.localeCompare(expected, undefined, { sensitivity: "accent" }) === 0) return true;
  const prefix = `${expected} - `;
  if (!actual.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) return false;
  return validGeneratedInitialSuffix(actual.slice(prefix.length), initials);
}

/**
 * Filter matching only. Recurrence metadata never removes an event here: the
 * classifier below decides eligibility so detached instances stay visible.
 */
export function eventMatchesFilters(
  event: BulkDeleteComparableEvent,
  filters: BulkDeleteFilters,
  initials: string[],
): boolean {
  if (!titleMatchesFilter(event.title, filters.title, initials)) return false;
  if (event.date < filters.start_date) return false;
  if (filters.end_date && event.date > filters.end_date) return false;
  if (filters.start_time && event.start_time !== filters.start_time) return false;
  if (filters.end_time && event.end_time !== filters.end_time) return false;
  return true;
}

/**
 * Classifies one match. A live recurring master (or a live parent series) is
 * protected; stale recurrence pointers with no working series are detached and
 * therefore eligible for cleanup.
 */
export function classifyRecurrence(input: {
  hasRecurrenceRule: boolean;
  recurringEventId: string | null;
  masterState: "live_series" | "gone" | null;
}): RecurrenceStatus {
  if (input.hasRecurrenceRule) return "healthy_recurring";
  if (input.recurringEventId) {
    return input.masterState === "live_series" ? "healthy_recurring" : "detached";
  }
  return "standalone";
}

export function statusReason(status: RecurrenceStatus): string | null {
  if (status === "healthy_recurring") return "Belongs to an active repeating series";
  if (status === "detached") return "Detached instance of a broken series";
  return null;
}

export function previewIdentity(items: BulkDeletePreviewItem[]): string {
  return items
    .map((item) =>
      [
        item.key,
        item.title,
        item.date,
        item.start_time ?? "",
        item.end_time ?? "",
        item.exists_in,
        item.recurrence_status,
        item.eligible ? "eligible" : "protected",
        item.ofc_event_id ?? "",
        ...item.google_event_ids.slice().sort(),
      ].join("|"),
    )
    .sort()
    .join("\n");
}

export function targetFromPreviewItem(item: BulkDeletePreviewItem): BulkDeleteTarget {
  return {
    key: item.key,
    title: item.title,
    date: item.date,
    google_event_ids: item.google_event_ids.slice().sort(),
    ofc_event_id: item.ofc_event_id,
  };
}

export function targetIdentity(targets: BulkDeleteTarget[]): string {
  return targets
    .map((target) =>
      [
        target.key,
        target.title,
        target.date,
        target.ofc_event_id ?? "",
        ...target.google_event_ids.slice().sort(),
      ].join("|"),
    )
    .sort()
    .join("\n");
}
