/**
 * Ref-counted document.body scroll lock for Sheets / modals.
 * Nested overlays must not restore overflow while another lock is still active
 * (that left Trip Planner stuck with overflow:hidden until a full reload).
 */

let lockCount = 0;
let previousOverflow = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};

  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = previousOverflow;
      previousOverflow = "";
    }
  };
}

/** Force-clear after a bad restore (e.g. stale lock from a crashed overlay). */
export function resetBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  lockCount = 0;
  previousOverflow = "";
  document.body.style.overflow = "";
}
