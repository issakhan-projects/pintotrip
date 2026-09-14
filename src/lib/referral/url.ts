/**
 * Invite path: /invite/{code}?rid={referralId}
 * Absolute URL = origin + path (use current origin so localhost stays http).
 */

export function buildInvitePath(code: string, referralId: string): string {
  const params = new URLSearchParams({ rid: referralId });
  return `/invite/${encodeURIComponent(code)}?${params.toString()}`;
}

export function buildInviteAbsoluteUrl(
  code: string,
  referralId: string,
  origin?: string
): string {
  const path = buildInvitePath(code, referralId);
  if (origin) return `${origin.replace(/\/$/, "")}${path}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

/** Login/register capture URL after invite landing. */
export function buildRegisterCapturePath(
  code: string,
  referralId?: string | null
): string {
  const params = new URLSearchParams({
    ref: code,
    tab: "register",
  });
  if (referralId) params.set("rid", referralId);
  return `/login?${params.toString()}`;
}
