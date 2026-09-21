"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { Check, Copy, Link2, Share2, Users } from "lucide-react";
import { buildInviteAbsoluteUrl } from "@/lib/referral";
import { devLog } from "@/lib/devLog";
import { createReferral } from "@/services/functions";
import { REFERRAL_REWARD_AI_CREDITS } from "@/types/credits";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AnalyticsEvents } from "@/types/analytics";

interface InviteFriendsSheetProps {
  open: boolean;
  onClose: () => void;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      code: string;
      referralId: string;
      url: string;
      rewardCredits: number;
    }
  | { status: "error"; message: string };

/**
 * Shareable invite link + code. Creates a pending referral on open.
 */
export function InviteFriendsSheet({ open, onClose }: InviteFriendsSheetProps) {
  const { trackEvent } = useAnalytics();
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [copied, setCopied] = useState<"code" | "url" | null>(null);
  const [sharing, setSharing] = useState(false);

  const loadInvite = useCallback(async () => {
    setState({ status: "loading" });
    setCopied(null);
    try {
      const result = await createReferral();
      const url = buildInviteAbsoluteUrl(result.code, result.referralId);
      setState({
        status: "ready",
        code: result.code,
        referralId: result.referralId,
        url,
        rewardCredits: result.rewardCredits ?? REFERRAL_REWARD_AI_CREDITS,
      });
      trackEvent(AnalyticsEvents.INVITE_CREATED, {
        rewardCredits: result.rewardCredits ?? REFERRAL_REWARD_AI_CREDITS,
      });
    } catch (err) {
      devLog.error("[InviteFriendsSheet] createReferral failed", err);
      setState({
        status: "error",
        message:
          err instanceof Error && err.message
            ? err.message
            : "Could not create invite. Try again.",
      });
    }
  }, [trackEvent]);

  useEffect(() => {
    if (!open) {
      setState({ status: "idle" });
      setCopied(null);
      return;
    }
    void loadInvite();
  }, [open, loadInvite]);

  async function copyText(kind: "code" | "url", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      trackEvent(AnalyticsEvents.INVITE_COPIED, { kind });
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setState((prev) =>
        prev.status === "ready"
          ? {
              status: "error",
              message: "Could not copy. Select the text and copy manually.",
            }
          : prev
      );
    }
  }

  async function handleShare() {
    if (state.status !== "ready") return;
    setSharing(true);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: "Join me on PinToTrip",
          text: `Join PinToTrip with my invite — I get ${state.rewardCredits} AI credits when you sign up.`,
          url: state.url,
        });
        trackEvent(AnalyticsEvents.INVITE_SHARED, { method: "web_share" });
      } else {
        await copyText("url", state.url);
        trackEvent(AnalyticsEvents.INVITE_SHARED, { method: "clipboard" });
      }
    } catch (err) {
      // User cancelled share sheet — ignore AbortError.
      if (err && typeof err === "object" && "name" in err) {
        if ((err as { name: string }).name === "AbortError") return;
      }
      await copyText("url", state.url);
    } finally {
      setSharing(false);
    }
  }

  const reward =
    state.status === "ready"
      ? state.rewardCredits
      : REFERRAL_REWARD_AI_CREDITS;

  return (
    <Sheet open={open} onClose={onClose} title="Invite friends" size="sm">
      <div className="space-y-5">
        <div className="flex gap-3 rounded-2xl border border-border bg-surface p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-text">
              Invite friends · get {reward} credits when they join
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              Share your link. When a friend signs up and finishes setup, you
              earn AI credits. Each friend can only use one invite.
            </p>
          </div>
        </div>

        {state.status === "loading" || state.status === "idle" ? (
          <p className="text-sm text-text-secondary">Preparing your invite…</p>
        ) : null}

        {state.status === "error" ? (
          <div className="space-y-3">
            <p className="text-sm text-error" role="alert">
              {state.message}
            </p>
            <Button variant="secondary" onClick={() => void loadInvite()}>
              Try again
            </Button>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Invite code
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-base font-semibold tracking-widest text-text">
                  {state.code}
                </code>
                <Button
                  variant="secondary"
                  icon={copied === "code" ? Check : Copy}
                  aria-label="Copy invite code"
                  onClick={() => void copyText("code", state.code)}
                >
                  {copied === "code" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Invite link
              </p>
              <div className="mt-1.5 flex items-start gap-2">
                <p className="min-w-0 flex-1 break-all rounded-xl border border-border bg-background px-3 py-2.5 text-xs text-text-secondary">
                  <Link2
                    className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom text-text-muted"
                    aria-hidden
                  />
                  {state.url}
                </p>
                <Button
                  variant="secondary"
                  icon={copied === "url" ? Check : Copy}
                  aria-label="Copy invite link"
                  onClick={() => void copyText("url", state.url)}
                >
                  {copied === "url" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <Button
              icon={Share2}
              loading={sharing}
              className="w-full"
              onClick={() => void handleShare()}
            >
              Share invite
            </Button>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
