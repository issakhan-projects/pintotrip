"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Heart,
  Lock,
  Mail,
  Shield,
  Users,
} from "lucide-react";
import {
  EMAIL_NOT_VERIFIED_CODE,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
} from "@/services/auth";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AnalyticsEvents } from "@/types/analytics";
import { getAdditionalUserInfo } from "firebase/auth";
import {
  markReferralAwaitOnboarding,
  markReferralRetry,
  peekPendingReferral,
  shouldRetryReferral,
  syncPendingReferralFromSearchParams,
} from "@/lib/referral";

type AuthTab = "login" | "register";

function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: string }).code);
    switch (code) {
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Incorrect email or password.";
      case "auth/email-already-in-use":
        return "An account with this email already exists.";
      case "auth/account-exists-with-different-credential":
        return "An account already exists with this email. Sign in with email/password, then link Google.";
      case "auth/weak-password":
        return "Password must be at least 6 characters.";
      case EMAIL_NOT_VERIFIED_CODE:
        return "Please verify your email before signing in. Check your inbox for the link.";
      case "auth/operation-not-allowed":
        return "This sign-in method is not enabled in Firebase Auth. Enable Email/Password and Google in the Firebase Console.";
      case "auth/unauthorized-domain":
        return "This domain is not authorized for Firebase Auth. Add localhost in Authentication → Settings.";
      case "auth/popup-closed-by-user":
        return "Sign-in was cancelled.";
      case "auth/popup-blocked":
        return "Pop-up was blocked by the browser. Allow pop-ups and try again.";
      default:
        return `Sign-in failed (${code}).`;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

const TRUST_ITEMS = [
  {
    icon: Shield,
    label: "Your data is safe and secure",
  },
  {
    icon: Users,
    label: "Join a global community",
  },
  {
    icon: Heart,
    label: "More places. A brighter you.",
  },
] as const;

const inputClassName =
  "w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20";

function initialTabFromParams(params: {
  get(name: string): string | null;
}): AuthTab {
  const tab = params.get("tab");
  if (tab === "register" || tab === "signup") return "register";
  if (params.get("ref") || params.get("code") || params.get("rid")) {
    return "register";
  }
  return "login";
}

export function AuthTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { trackEvent, identifyUser } = useAnalytics();
  const [tab, setTab] = useState<AuthTab>(() =>
    initialTabFromParams(searchParams)
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inviteHint, setInviteHint] = useState<string | null>(null);

  useEffect(() => {
    const pending = syncPendingReferralFromSearchParams(searchParams);
    if (pending) {
      setInviteHint(
        `Invite ${pending.code} saved — create your account to continue.`
      );
      setTab("register");
    } else {
      const existing = peekPendingReferral();
      if (existing) {
        setInviteHint(`Invite ${existing.code} ready after you sign up.`);
      }
    }
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      if (tab === "login") {
        const credential = await signInWithEmail({ email, password });
        identifyUser(credential.user.uid, { email: credential.user.email });
        trackEvent(AnalyticsEvents.LOGIN, { method: "email" });
        if (peekPendingReferral() && shouldRetryReferral()) {
          markReferralRetry();
        }
        router.push("/map");
        router.refresh();
      } else {
        trackEvent(AnalyticsEvents.SIGNUP_STARTED, { method: "email" });
        syncPendingReferralFromSearchParams(searchParams);
        const credential = await signUpWithEmail({
          email,
          password,
          displayName: name.trim() || undefined,
        });
        identifyUser(credential.user.uid, { email: credential.user.email });
        trackEvent(AnalyticsEvents.SIGNUP_COMPLETED, { method: "email" });
        if (peekPendingReferral()) {
          markReferralAwaitOnboarding();
        }
        setPassword("");
        setTab("login");
        setSuccess(
          "Account created. Check your email for a verification link, then sign in."
        );
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      syncPendingReferralFromSearchParams(searchParams);
      const credential = await signInWithGoogle();
      const additional = getAdditionalUserInfo(credential);
      const isNewUser = additional?.isNewUser ?? false;

      identifyUser(credential.user.uid, {
        email: credential.user.email,
        name: credential.user.displayName,
      });

      if (isNewUser) {
        trackEvent(AnalyticsEvents.GOOGLE_SIGNUP);
        trackEvent(AnalyticsEvents.SIGNUP_COMPLETED, { method: "google" });
        if (peekPendingReferral()) {
          markReferralAwaitOnboarding();
        }
      } else {
        trackEvent(AnalyticsEvents.LOGIN, { method: "google" });
        if (peekPendingReferral() && shouldRetryReferral()) {
          markReferralRetry();
        }
      }

      router.push("/map");
      router.refresh();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-6 shadow-sm sm:p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Welcome to PinToTrip
        </h1>
        <p className="mt-1.5 text-sm text-text-secondary">
          Sign in to your account or create a new one
        </p>
      </div>

      {inviteHint ? (
        <p
          className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-text"
          role="status"
        >
          {inviteHint}
        </p>
      ) : null}

      <div
        role="tablist"
        aria-label="Authentication"
        className="mt-6 grid grid-cols-2 rounded-full bg-surface p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "login"}
          onClick={() => {
            setTab("login");
            setError(null);
          }}
          className={`rounded-full py-2 text-sm font-medium transition-all ${
            tab === "login"
              ? "bg-background text-text shadow-sm"
              : "text-text-secondary hover:text-text"
          }`}
        >
          Log in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "register"}
          onClick={() => {
            setTab("register");
            setError(null);
            setSuccess(null);
          }}
          className={`rounded-full py-2 text-sm font-medium transition-all ${
            tab === "register"
              ? "bg-background text-text shadow-sm"
              : "text-text-secondary hover:text-text"
          }`}
        >
          Register
        </button>
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={submitting}
        className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface disabled:opacity-50"
      >
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-xs text-text-muted">
        <div className="h-px flex-1 bg-border" />
        <span>or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {tab === "register" ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">Name</span>
            <input
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="Your name"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">Email</span>
          <span className="relative">
            <Mail
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              aria-hidden
            />
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClassName}
              placeholder="you@example.com"
            />
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">Password</span>
          <span className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              aria-hidden
            />
            <input
              type="password"
              name="password"
              autoComplete={
                tab === "login" ? "current-password" : "new-password"
              }
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClassName}
              placeholder="At least 6 characters"
            />
          </span>
        </label>

        {error ? (
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}

        {success ? (
          <p
            className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-text"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary mt-1 h-11 w-full rounded-xl text-sm"
        >
          {submitting ? "Please wait…" : "Continue"}
          {!submitting ? (
            <ArrowRight className="h-4 w-4" aria-hidden />
          ) : null}
        </button>
      </form>

      {tab === "login" ? (
        <p className="mt-4 text-center text-sm">
          <span className="cursor-default text-text-secondary transition-colors hover:text-text">
            Forgot your password?
          </span>
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-3 gap-3 border-t border-divider pt-5">
        {TRUST_ITEMS.map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-2 text-center"
          >
            <Icon className="h-4 w-4 text-text-muted" aria-hidden />
            <p className="text-[10px] leading-snug text-text-muted sm:text-[11px]">
              {label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
