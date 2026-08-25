import { describe, expect, it, vi } from "vitest";

import { errorMessage, runGuardedMutation } from "../src/lib/async-submit";

function harness() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    setBusy: (next: boolean) => {
      busy = next;
    },
  };
}

describe("guarded mutations", () => {
  it("reports success only after the server resolves", async () => {
    const order: string[] = [];
    const state = harness();
    await runGuardedMutation({
      busy: state.busy,
      setBusy: state.setBusy,
      perform: async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("saved");
      },
      onSuccess: () => order.push("toast+close"),
      onError: () => order.push("error"),
    });
    expect(order).toEqual(["saved", "toast+close"]);
  });

  it("does not close or report success when the create fails", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const state = harness();
    const result = await runGuardedMutation({
      busy: state.busy,
      setBusy: state.setBusy,
      perform: async () => {
        throw new Error("Row level security violated");
      },
      onSuccess,
      onError,
    });
    expect(result).toBe("failed");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Row level security violated");
    expect(state.busy).toBe(false);
  });

  it("does not report a successful update/delete/reschedule on failure", async () => {
    const onSuccess = vi.fn();
    for (const failure of ["update", "delete", "reschedule"]) {
      const state = harness();
      // eslint-disable-next-line no-await-in-loop
      const outcome = await runGuardedMutation({
        busy: state.busy,
        setBusy: state.setBusy,
        perform: async () => {
          throw new Error(`${failure} failed`);
        },
        onSuccess,
        onError: () => {},
      });
      expect(outcome).toBe("failed");
    }
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("ignores a duplicate submit while a mutation is pending", async () => {
    const perform = vi.fn(async () => {});
    const outcome = await runGuardedMutation({
      busy: true,
      setBusy: () => {},
      perform,
      onSuccess: () => {},
      onError: () => {},
    });
    expect(outcome).toBe("skipped");
    expect(perform).not.toHaveBeenCalled();
  });

  it("falls back to a readable error message", () => {
    expect(errorMessage(undefined, "Could not save")).toBe("Could not save");
    expect(errorMessage(new Error("nope"))).toBe("nope");
  });
});
