export interface BulkDeleteFilters {
  source_id: string;
  title: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
}

export interface BulkDeleteComparableEvent {
  id: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  recurring: boolean;
}

export interface BulkDeletePreviewItem {
  key: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  calendar_name: string;
  exists_in: "Google" | "OFC" | "Both";
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

export function eventMatchesFilters(
  event: BulkDeleteComparableEvent,
  filters: BulkDeleteFilters,
  initials: string[],
): boolean {
  if (event.recurring) return false;
  if (!titleMatchesFilter(event.title, filters.title, initials)) return false;
  if (event.date < filters.start_date || event.date > filters.end_date) return false;
  if (filters.start_time && event.start_time !== filters.start_time) return false;
  if (filters.end_time && event.end_time !== filters.end_time) return false;
  return true;
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
        item.ofc_event_id ?? "",
        ...item.google_event_ids.slice().sort(),
      ].join("|"),
    )
    .sort()
    .join("\n");
}