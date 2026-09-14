/**
 * Local persistence for the in-app review prompt.
 * Tracks meaningful app usage and dismissals so we only ask after some use.
 */

const STORAGE_KEY = "pintototrip.reviewPrompt.v1";

/** Show after this many counted app opens. */
export const REVIEW_PROMPT_MIN_SESSIONS = 3;

/** Require at least this many saved places or favorite cities. */
export const REVIEW_PROMPT_MIN_SAVED_ITEMS = 1;

/** Wait this long after mount before opening the sheet (ms). */
export const REVIEW_PROMPT_DELAY_MS = 2500;

/** Minimum gap between counted opens (ms) — avoids spam on refresh. */
export const REVIEW_PROMPT_SESSION_GAP_MS = 60 * 60 * 1000;

/** Snooze duration after "Not now" (ms) — 7 days. */
export const REVIEW_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export type ReviewPromptState = {
  /** How many meaningful app opens we have counted. */
  sessionCount: number;
  /** Epoch ms of the last counted open. */
  lastSessionAt: number | null;
  /** Epoch ms when the user last dismissed without submitting. */
  dismissedAt: number | null;
  /** True after a successful one-time review submit on this device. */
  completed: boolean;
};

function emptyState(): ReviewPromptState {
  return {
    sessionCount: 0,
    lastSessionAt: null,
    dismissedAt: null,
    completed: false,
  };
}

export function readReviewPromptState(): ReviewPromptState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<ReviewPromptState> & {
      /** Legacy field from day-based tracking. */
      sessionDays?: string[];
    };

    const completed = parsed.completed === true;
    const dismissedAt =
      typeof parsed.dismissedAt === "number" ? parsed.dismissedAt : null;

    if (
      typeof parsed.sessionCount === "number" &&
      Number.isFinite(parsed.sessionCount)
    ) {
      return {
        sessionCount: Math.max(0, Math.floor(parsed.sessionCount)),
        lastSessionAt:
          typeof parsed.lastSessionAt === "number"
            ? parsed.lastSessionAt
            : null,
        dismissedAt,
        completed,
      };
    }

    // Migrate older day-list shape if present.
    const days = Array.isArray(parsed.sessionDays)
      ? parsed.sessionDays.length
      : 0;
    return {
      sessionCount: days,
      lastSessionAt: null,
      dismissedAt,
      completed,
    };
  } catch {
    return emptyState();
  }
}

function writeReviewPromptState(state: ReviewPromptState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Record a meaningful app open.
 * Counts at most once per REVIEW_PROMPT_SESSION_GAP_MS.
 */
export function recordReviewPromptSession(): ReviewPromptState {
  const state = readReviewPromptState();
  const now = Date.now();
  if (
    state.lastSessionAt === null ||
    now - state.lastSessionAt >= REVIEW_PROMPT_SESSION_GAP_MS
  ) {
    state.sessionCount += 1;
    state.lastSessionAt = now;
    writeReviewPromptState(state);
  }
  return state;
}

export function dismissReviewPrompt(): void {
  const state = readReviewPromptState();
  state.dismissedAt = Date.now();
  writeReviewPromptState(state);
}

/** Permanently mark the one-time review as done on this device. */
export function markReviewCompleted(): void {
  const state = readReviewPromptState();
  state.completed = true;
  state.dismissedAt = null;
  writeReviewPromptState(state);
}

export function clearReviewPromptDismissal(): void {
  const state = readReviewPromptState();
  if (state.completed) return;
  state.dismissedAt = null;
  writeReviewPromptState(state);
}

export function shouldOfferReviewPrompt(params: {
  hasLeftReview: boolean;
  savedItemCount: number;
}): boolean {
  if (params.hasLeftReview) return false;

  const state = readReviewPromptState();
  if (state.completed) return false;

  if (params.savedItemCount < REVIEW_PROMPT_MIN_SAVED_ITEMS) return false;
  if (state.sessionCount < REVIEW_PROMPT_MIN_SESSIONS) return false;

  if (
    state.dismissedAt !== null &&
    Date.now() - state.dismissedAt < REVIEW_PROMPT_SNOOZE_MS
  ) {
    return false;
  }

  return true;
}
