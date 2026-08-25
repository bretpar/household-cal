/**
 * One place for "await persistence before reporting success".
 *
 * Every mutating surface (add / edit / delete / drag-reschedule) routes through
 * here so a success toast, dialog close, or state reset can never run before the
 * server has actually accepted the change, and a second click while a mutation
 * is in flight is ignored.
 */

export const DEFAULT_MUTATION_ERROR = "Something went wrong. Please try again.";

export function errorMessage(error: unknown, fallback = DEFAULT_MUTATION_ERROR): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export interface GuardedMutation<T> {
  /** true while a previous run is still pending */
  busy: boolean;
  setBusy: (next: boolean) => void;
  perform: () => Promise<T>;
  /** runs only after `perform` resolves */
  onSuccess: (result: T) => void;
  onError: (message: string) => void;
  errorFallback?: string;
}

export type MutationOutcome = "skipped" | "ok" | "failed";

export async function runGuardedMutation<T>(
  options: GuardedMutation<T>,
): Promise<MutationOutcome> {
  if (options.busy) return "skipped";
  options.setBusy(true);
  try {
    const result = await options.perform();
    options.onSuccess(result);
    return "ok";
  } catch (error) {
    options.onError(errorMessage(error, options.errorFallback));
    return "failed";
  } finally {
    options.setBusy(false);
  }
}
