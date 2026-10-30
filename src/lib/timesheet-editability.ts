/** Cached sheet data is display-only until this observer has revalidated it. */
export function timesheetStatusRevalidated(query: {
  isFetchedAfterMount: boolean;
  isSuccess: boolean;
  isFetching: boolean;
}): boolean {
  return query.isFetchedAfterMount && query.isSuccess && !query.isFetching;
}