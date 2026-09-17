/**
 * Development-only probe that reports when the shared app shell (header or
 * floating bottom navigation) unmounts during a bottom-tab navigation.
 * Those parts are expected to stay mounted while only the central page
 * content changes, so an unmount between tabs is a regression signal.
 *
 * No-ops in production builds.
 */

type ShellPart = "header" | "bottom-nav";

interface ShellProbeState {
  mounts: number;
  lastPath: string | null;
  unmountedAt: string | null;
  unmountedTime: number;
}

const state: Record<ShellPart, ShellProbeState> = {
  header: { mounts: 0, lastPath: null, unmountedAt: null, unmountedTime: 0 },
  "bottom-nav": { mounts: 0, lastPath: null, unmountedAt: null, unmountedTime: 0 },
};

/** Window (ms) in which an unmount + remount counts as a route transition remount. */
const REMOUNT_WINDOW_MS = 1500;

export function shellProbeSnapshot(part: ShellPart): ShellProbeState {
  return { ...state[part] };
}

export function resetShellProbe() {
  for (const key of Object.keys(state) as ShellPart[]) {
    state[key] = { mounts: 0, lastPath: null, unmountedAt: null, unmountedTime: 0 };
  }
}

/**
 * Records a mount and returns a warning string when the part was unmounted a
 * moment ago on a different path — i.e. it remounted across a tab change.
 */
export function recordShellMount(
  part: ShellPart,
  pathname: string,
  now = Date.now(),
): string | null {
  const prev = state[part];
  const remountedAcrossTabs =
    prev.mounts > 0 &&
    prev.unmountedAt !== null &&
    now - prev.unmountedTime <= REMOUNT_WINDOW_MS &&
    prev.unmountedAt !== pathname;

  state[part] = {
    mounts: prev.mounts + 1,
    lastPath: pathname,
    unmountedAt: null,
    unmountedTime: 0,
  };

  return remountedAcrossTabs
    ? `[shell-probe] ${part} remounted during navigation ${prev.unmountedAt} -> ${pathname} (mount #${state[part].mounts})`
    : null;
}

export function recordShellUnmount(part: ShellPart, pathname: string, now = Date.now()) {
  state[part] = { ...state[part], unmountedAt: pathname, unmountedTime: now };
}

/** React-side hook body helper: logs the warning in dev only. */
export function reportShellMount(part: ShellPart, pathname: string) {
  if (!import.meta.env.DEV) return;
  const warning = recordShellMount(part, pathname);
  if (warning) console.warn(warning);
}

export function reportShellUnmount(part: ShellPart, pathname: string) {
  if (!import.meta.env.DEV) return;
  recordShellUnmount(part, pathname);
}
