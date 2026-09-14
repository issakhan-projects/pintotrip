/**
 * Pending referral capture in localStorage so completion can run after
 * auth/onboarding even if query params are lost.
 */

const KEY_CODE = "pintototrip.referralCode";
const KEY_ID = "pintototrip.referralId";
const KEY_RETRY = "pintototrip.referralRetry";
const KEY_AWAIT = "pintototrip.referralAwaitOnboarding";

export type PendingReferral = {
  code: string;
  referralId: string | null;
};

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function storePendingReferral(
  code: string,
  referralId?: string | null
): void {
  safeSet(KEY_CODE, code.trim().toUpperCase());
  if (referralId) {
    safeSet(KEY_ID, referralId);
  } else {
    safeRemove(KEY_ID);
  }
}

export function peekPendingReferral(): PendingReferral | null {
  const code = safeGet(KEY_CODE);
  if (!code) return null;
  return {
    code,
    referralId: safeGet(KEY_ID),
  };
}

export function clearPendingReferral(): void {
  safeRemove(KEY_CODE);
  safeRemove(KEY_ID);
  safeRemove(KEY_RETRY);
  safeRemove(KEY_AWAIT);
}

export function markReferralAwaitOnboarding(): void {
  safeSet(KEY_AWAIT, "1");
}

export function isReferralAwaitingOnboarding(): boolean {
  return safeGet(KEY_AWAIT) === "1";
}

export function clearReferralAwaitOnboarding(): void {
  safeRemove(KEY_AWAIT);
}

export function markReferralRetry(): void {
  safeSet(KEY_RETRY, "1");
}

export function shouldRetryReferral(): boolean {
  return safeGet(KEY_RETRY) === "1";
}

export function clearReferralRetry(): void {
  safeRemove(KEY_RETRY);
}

/**
 * Sync pending referral from URL search params (`ref`/`code` + `rid`) into localStorage.
 */
export function syncPendingReferralFromSearchParams(
  params: URLSearchParams | { get(name: string): string | null }
): PendingReferral | null {
  const raw =
    params.get("ref") ?? params.get("code") ?? params.get("referral");
  const rid = params.get("rid") ?? params.get("referralId");
  if (!raw || !raw.trim()) return peekPendingReferral();

  const code = raw.trim().toUpperCase();
  storePendingReferral(code, rid?.trim() || null);
  return { code, referralId: rid?.trim() || null };
}
