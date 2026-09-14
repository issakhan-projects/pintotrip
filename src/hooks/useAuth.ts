"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  isUnverifiedPasswordUser,
  logout,
  subscribeToAuthState,
} from "@/services/auth";

export interface AuthState {
  user: User | null;
  loading: boolean;
}

/**
 * Auth state listener hook — no UI, foundation only.
 * Unverified email/password sessions are signed out so they cannot use the app.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((next) => {
      if (next && isUnverifiedPasswordUser(next)) {
        void logout().finally(() => {
          setUser(null);
          setLoading(false);
        });
        return;
      }
      setUser(next);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { user, loading };
}
