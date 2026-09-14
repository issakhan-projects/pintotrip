"use client";

import { useEffect, useState } from "react";
import { ensureUserProfile, subscribeUserProfile } from "@/services/users";
import { initRealtimeVisibilityPause } from "@/lib/firebase/realtime-sync";
import type { User } from "firebase/auth";
import type { UserProfile } from "@/types/user";

export interface UserProfileState {
  profile: UserProfile | null;
  /** True while reading or creating the users/{uid} document. */
  loading: boolean;
  error: string | null;
}

function firestoreErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: string }).code);
    if (code === "permission-denied") {
      return "Could not save your profile (permission denied). Deploy Firestore rules, then try again.";
    }
    return `Could not save your profile (${code}).`;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Could not save your profile. Please try again.";
}

/**
 * Live users/{uid} subscription. Creates the document inside the app if missing.
 */
export function useUserProfile(user: User | undefined | null): UserProfileState {
  const userId = user?.uid;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initRealtimeVisibilityPause();
  }, []);

  useEffect(() => {
    if (!userId || !user) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    let cancelled = false;
    let ensureStarted = false;

    const unsubscribe = subscribeUserProfile(
      userId,
      (next) => {
        if (cancelled) return;

        if (next) {
          setProfile(next);
          setLoading(false);
          setError(null);
          return;
        }

        if (ensureStarted) return;
        ensureStarted = true;

        void ensureUserProfile({
          userId,
          email: user.email,
          displayName: user.displayName,
          photoUrl: user.photoURL,
        })
          .then((created) => {
            if (cancelled) return;
            setProfile(created);
            setLoading(false);
            setError(null);
          })
          .catch((err) => {
            console.error("[useUserProfile] ensureUserProfile failed", err);
            if (cancelled) return;
            setProfile(null);
            setLoading(false);
            setError(firestoreErrorMessage(err));
          });
      },
      (err) => {
        console.error("[useUserProfile] snapshot error", err);
        if (cancelled) return;

        // Snapshot failed (often permission-denied on missing rules) — still try create.
        if (!ensureStarted) {
          ensureStarted = true;
          void ensureUserProfile({
            userId,
            email: user.email,
            displayName: user.displayName,
            photoUrl: user.photoURL,
          })
            .then((created) => {
              if (cancelled) return;
              setProfile(created);
              setLoading(false);
              setError(null);
            })
            .catch((createErr) => {
              console.error("[useUserProfile] ensure after snapshot error failed", createErr);
              if (cancelled) return;
              setProfile(null);
              setLoading(false);
              setError(firestoreErrorMessage(createErr));
            });
          return;
        }

        setProfile(null);
        setLoading(false);
        setError(firestoreErrorMessage(err));
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user, userId]);

  return { profile, loading, error };
}
