/**
 * Central realtime sync gate.
 *
 * Live listeners are only active when:
 *   effectiveLive = planAllowsRealtime && pageVisible && foregroundEngaged
 *
 * Hidden pages detach onSnapshot after HIDE_DEBOUNCE but keep network enabled.
 * Reattach only on genuine return (focus / user interaction), not mere visibility.
 */

export type RealtimeSyncMode = "live" | "paused" | "session";

export type RealtimeSyncSnapshot = {
  mode: RealtimeSyncMode;
  effectiveLive: boolean;
  planAllowsRealtime: boolean;
  pageVisible: boolean;
  foregroundEngaged: boolean;
  enabled: boolean;
};

type ModeListener = (snapshot: RealtimeSyncSnapshot) => void;

const SHOW_STABLE_MS = 2_000;
const HIDE_DEBOUNCE_MS = 30_000;
const BOOT_GRACE_MS = 3_000;

let initialized = false;
let planAllowsRealtime = false;
let enabledOverride: boolean | null = null;
let pageVisible = true;
let foregroundEngaged = true;
let bootGraceUntil = 0;

let hideTimer: ReturnType<typeof setTimeout> | null = null;
let showStableTimer: ReturnType<typeof setTimeout> | null = null;
let visibleButNotEngaged = false;

const modeListeners = new Set<ModeListener>();

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function clearShowStableTimer(): void {
  if (showStableTimer) {
    clearTimeout(showStableTimer);
    showStableTimer = null;
  }
}

function isBootGrace(): boolean {
  return Date.now() < bootGraceUntil;
}

function computeSnapshot(): RealtimeSyncSnapshot {
  const enabled =
    enabledOverride !== null ? enabledOverride : planAllowsRealtime;
  const engaged = foregroundEngaged || isBootGrace();
  const effectiveLive = enabled && pageVisible && engaged && !visibleButNotEngaged;
  let mode: RealtimeSyncMode;
  if (!enabled) {
    mode = "session";
  } else if (effectiveLive) {
    mode = "live";
  } else {
    mode = "paused";
  }
  return {
    mode,
    effectiveLive,
    planAllowsRealtime: enabled,
    pageVisible,
    foregroundEngaged: engaged,
    enabled,
  };
}

function emit(): void {
  const snapshot = computeSnapshot();
  for (const listener of modeListeners) {
    listener(snapshot);
  }
}

function markEngaged(): void {
  const wasEngaged = foregroundEngaged && !visibleButNotEngaged;
  foregroundEngaged = true;
  visibleButNotEngaged = false;
  clearHideTimer();
  if (pageVisible && !wasEngaged) {
    emit();
  } else if (!wasEngaged) {
    emit();
  }
}

function onHidden(): void {
  clearShowStableTimer();
  // Do not immediately detach — debounce hide.
  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    pageVisible = false;
    foregroundEngaged = false;
    visibleButNotEngaged = false;
    emit();
  }, HIDE_DEBOUNCE_MS);
}

function onShownVisibleOnly(): void {
  // visibilityState became visible — do NOT reattach listeners yet.
  clearHideTimer();
  pageVisible = true;
  visibleButNotEngaged = true;
  foregroundEngaged = false;
  clearShowStableTimer();
  showStableTimer = setTimeout(() => {
    showStableTimer = null;
    // Still waiting for genuine engagement; stay paused.
    emit();
  }, SHOW_STABLE_MS);
  emit();
}

function onGenuineReturn(): void {
  clearHideTimer();
  clearShowStableTimer();
  pageVisible = true;
  markEngaged();
}

function handleVisibilityChange(): void {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") {
    onHidden();
  } else {
    onShownVisibleOnly();
  }
}

function handleFocus(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }
  onGenuineReturn();
}

function handlePageHide(): void {
  onHidden();
}

function handlePageShow(): void {
  // pageshow after bfcache — treat as visible-only until interaction/focus.
  onShownVisibleOnly();
}

function handleFreeze(): void {
  onHidden();
}

function handleResume(): void {
  onShownVisibleOnly();
}

function handleUserGesture(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }
  onGenuineReturn();
}

/**
 * Install visibility / engagement listeners once (client only).
 */
export function initRealtimeVisibilityPause(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  bootGraceUntil = Date.now() + BOOT_GRACE_MS;

  pageVisible =
    typeof document === "undefined" || document.visibilityState !== "hidden";
  foregroundEngaged = pageVisible;
  visibleButNotEngaged = false;

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleFocus);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  // freeze/resume are experimental but useful for mobile background thaw.
  document.addEventListener("freeze", handleFreeze as EventListener);
  document.addEventListener("resume", handleResume as EventListener);
  window.addEventListener("pointerdown", handleUserGesture, { passive: true });
  window.addEventListener("keydown", handleUserGesture);
  window.addEventListener("touchstart", handleUserGesture, { passive: true });

  // End boot grace with an emit so listeners can attach if still engaged.
  window.setTimeout(() => {
    emit();
  }, BOOT_GRACE_MS + 10);

  emit();
}

/** Plan / subscription gate for realtime (paid → live eligible). */
export function setRealtimeSyncFromPlan(
  plan: string | null | undefined
): void {
  const normalized = (plan ?? "free").toLowerCase();
  const allows = normalized === "plus" || normalized === "pro";
  if (planAllowsRealtime === allows) return;
  planAllowsRealtime = allows;
  emit();
}

/** Manual override (null clears override and uses plan gate). */
export function setRealtimeSyncEnabled(enabled: boolean | null): void {
  if (enabledOverride === enabled) return;
  enabledOverride = enabled;
  emit();
}

export function isRealtimeSyncEnabled(): boolean {
  return computeSnapshot().enabled;
}

export function getRealtimeSyncSnapshot(): RealtimeSyncSnapshot {
  return computeSnapshot();
}

export function subscribeRealtimeSyncMode(
  callback: ModeListener
): () => void {
  modeListeners.add(callback);
  callback(computeSnapshot());
  return () => {
    modeListeners.delete(callback);
  };
}

export type RealtimeAwareBinding = {
  /** Attach onSnapshot (or equivalent). Return detach. */
  attachLive: () => () => void;
  /**
   * One-shot session/cache load when live is not allowed.
   * Called once when entering session mode (or on first bind).
   */
  attachSession: () => void | Promise<void>;
};

/**
 * Bind a subscription that follows the central realtime gate.
 *
 * Live + foreground → attachLive()
 * Paused → detach only (keep memory; do not getDocs)
 * No live access → attachSession() once
 * Resume → attachLive()
 */
export function bindRealtimeAwareSubscription(
  binding: RealtimeAwareBinding
): () => void {
  initRealtimeVisibilityPause();

  let detachLive: (() => void) | null = null;
  let sessionAttached = false;
  let currentMode: RealtimeSyncMode | null = null;

  const apply = (snapshot: RealtimeSyncSnapshot) => {
    const { mode } = snapshot;
    if (mode === currentMode) return;

    if (mode === "live") {
      if (!detachLive) {
        detachLive = binding.attachLive();
      }
      currentMode = "live";
      return;
    }

    // Leaving live: detach listener only — keep memory, do not getDocs.
    if (detachLive) {
      detachLive();
      detachLive = null;
    }

    if (mode === "session") {
      if (!sessionAttached) {
        sessionAttached = true;
        void binding.attachSession();
      }
      currentMode = "session";
      return;
    }

    // paused — hydrate once only if we never attached (e.g. boot while hidden)
    if (!sessionAttached && currentMode === null) {
      sessionAttached = true;
      void binding.attachSession();
    }
    currentMode = "paused";
  };

  const unsubMode = subscribeRealtimeSyncMode(apply);

  return () => {
    unsubMode();
    if (detachLive) {
      detachLive();
      detachLive = null;
    }
  };
}
