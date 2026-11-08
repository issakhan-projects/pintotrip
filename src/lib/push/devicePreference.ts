/**
 * Per-device opt-in for web push (multi-device: each browser decides independently).
 */

const KEY = "pintototrip.push.deviceEnabled";

export function getDevicePushPreference(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function setDevicePushPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, enabled ? "1" : "0");
  } catch {
    // Private mode / quota — ignore.
  }
}
