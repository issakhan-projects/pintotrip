"use client";

import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import type { TimeFormat } from "@/types/user";

/** User clock preference from profile settings (defaults to 24h). */
export function useTimeFormat(): TimeFormat {
  const { user } = useAuth();
  const { profile } = useUserProfile(user);
  return profile?.preferences?.timeFormat ?? "24h";
}
