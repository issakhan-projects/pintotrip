"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  Backpack,
  CreditCard,
  Crown,
  FileText,
  Globe2,
  LogOut,
  MapPin,
  Pencil,
  Settings,
  Users,
} from "lucide-react";
import type { User } from "firebase/auth";
import type { SavedLocation } from "@/hooks/useLocations";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AnalyticsEvents } from "@/types/analytics";
import { computePlaceStats } from "@/features/places/groupLocations";
import { AiCreditsCard } from "@/features/profile/AiCreditsCard";
import { getPlanDefinition } from "@/features/profile/plans";
import { ProfileMenuRow } from "@/features/profile/ProfileMenuRow";
import { ProfileSubView } from "@/features/profile/ProfileSubView";
import { TravelPreferencesView } from "@/features/profile/TravelPreferencesView";
import { AccountView } from "@/features/profile/AccountView";
import { SubscriptionView } from "@/features/profile/SubscriptionView";
import { SettingsView } from "@/features/profile/SettingsView";
import { MyDocumentsView } from "@/features/profile/MyDocumentsView";
import {
  CountriesListView,
  PlacesFilterView,
} from "@/features/profile/TravelLists";
import { LegalContent, LegalLinks } from "@/features/profile/LegalLinks";
import { SupportView } from "@/features/profile/SupportView";
import { InviteFriendsSheet } from "@/features/referral";
import { REFERRAL_REWARD_AI_CREDITS } from "@/types/credits";
import { cx } from "@/lib/utils";

type ProfileView =
  | "home"
  | "countries"
  | "visited"
  | "travel"
  | "documents"
  | "account"
  | "subscription"
  | "settings"
  | "help"
  | "privacy"
  | "terms"
  | "about";

interface ProfilePanelProps {
  user: User;
  locations: SavedLocation[];
  locationsLoading?: boolean;
  onLogout: () => void;
  onOpenPlaces: () => void;
  onExploreMap: () => void;
}

export function ProfilePanel({
  user,
  locations,
  locationsLoading,
  onLogout,
  onOpenPlaces,
  onExploreMap,
}: ProfilePanelProps) {
  const router = useRouter();
  const { trackEvent, resetAnalytics } = useAnalytics();
  const { profile, loading: profileLoading } = useUserProfile(user);
  const [view, setView] = useState<ProfileView>("home");
  const [inviteOpen, setInviteOpen] = useState(false);

  const stats = useMemo(() => computePlaceStats(locations), [locations]);
  const visitedLocations = useMemo(
    () => locations.filter((l) => l.status === "visited"),
    [locations]
  );

  useEffect(() => {
    trackEvent(AnalyticsEvents.PROFILE_OPENED);
  }, [trackEvent]);

  const displayName = profile
    ? [profile.name, profile.lastname].filter(Boolean).join(" ").trim()
    : user.displayName || user.email?.split("@")[0] || "Traveler";
  const email = profile?.email || user.email || "";
  const rawPhotoUrl = profile?.photoUrl || user.photoURL || "";
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoUrl = photoFailed ? "" : rawPhotoUrl;
  const initial = (displayName || "T").charAt(0).toUpperCase();
  const plan = profile?.subscription?.plan ?? "free";
  const planName = getPlanDefinition(plan).name;
  const isPaidPlan = plan === "plus" || plan === "pro";
  const balance = profile?.aiCreditsBalance ?? 0;

  useEffect(() => {
    setPhotoFailed(false);
  }, [rawPhotoUrl]);

  function openStat(stat: "countries" | "places" | "visited") {
    trackEvent(AnalyticsEvents.PROFILE_STATISTICS_CLICKED, { stat });
    if (stat === "places") {
      onOpenPlaces();
      return;
    }
    setView(stat);
  }

  function openMenu(next: ProfileView, event: string) {
    trackEvent(event);
    setView(next);
  }

  async function handleLogout() {
    trackEvent(AnalyticsEvents.LOGOUT_COMPLETED);
    resetAnalytics();
    onLogout();
  }

  if (view !== "home") {
    const titles: Record<Exclude<ProfileView, "home">, string> = {
      countries: "Countries",
      visited: "Visited",
      travel: "Travel Preferences",
      documents: "My Documents",
      account: "Account",
      subscription: "Subscription",
      settings: "Settings",
      help: "Help & Support",
      privacy: "Privacy Policy",
      terms: "Terms of Service",
      about: "About",
    };

    return (
      <ProfileSubView title={titles[view]} onBack={() => setView("home")}>
        {view === "countries" ? (
          <CountriesListView
            locations={locations}
            onExploreMap={onExploreMap}
          />
        ) : null}
        {view === "visited" ? (
          <PlacesFilterView
            locations={visitedLocations}
            emptyTitle="No visited places yet"
            emptyBody="Mark places as visited when you go — they’ll show up here."
            onExploreMap={onExploreMap}
          />
        ) : null}
        {view === "travel" && profile ? (
          <TravelPreferencesView
            userId={user.uid}
            profile={profile}
            onSaved={() => undefined}
          />
        ) : null}
        {view === "documents" ? (
          <MyDocumentsView userId={user.uid} />
        ) : null}
        {view === "account" && profile ? (
          <AccountView
            user={user}
            profile={profile}
            onSaved={() => undefined}
          />
        ) : null}
        {view === "subscription" && profile ? (
          <SubscriptionView profile={profile} />
        ) : null}
        {view === "settings" && profile ? (
          <SettingsView
            userId={user.uid}
            profile={profile}
            onSaved={() => undefined}
          />
        ) : null}
        {view === "help" ? <SupportView userEmail={email} /> : null}
        {view === "privacy" || view === "terms" || view === "about" ? (
          <LegalContent page={view} />
        ) : null}
        {(view === "travel" ||
          view === "account" ||
          view === "subscription" ||
          view === "settings") &&
        !profile &&
        !profileLoading ? (
          <p className="text-sm text-text-secondary">
            Could not load your profile. Try again later.
          </p>
        ) : null}
      </ProfileSubView>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 pb-28 pt-6 md:px-8">
      <div className="mx-auto w-full max-w-lg md:max-w-none">
        {profileLoading || locationsLoading ? (
          <div className="animate-pulse rounded-3xl border border-border bg-surface-elevated p-5 shadow-sm">
            <div className="flex gap-5">
              <div className="h-24 w-24 shrink-0 rounded-full bg-surface" />
              <div className="min-w-0 flex-1 space-y-3 pt-1">
                <div className="h-5 w-36 rounded bg-surface" />
                <div className="h-4 w-48 rounded bg-surface" />
                <div className="h-14 rounded-2xl bg-surface" />
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 rounded-2xl bg-surface" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <section className="overflow-hidden rounded-3xl border border-border bg-surface-elevated shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
              <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6">
                <div className="flex shrink-0 flex-col items-center text-center sm:w-[9.75rem]">
                  <div className="relative">
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={() => setPhotoFailed(true)}
                        className="h-24 w-24 rounded-full bg-primary-tint object-cover ring-4 ring-white md:h-32 md:w-32"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-tint text-2xl font-semibold text-primary ring-4 ring-white md:h-32 md:w-32">
                        {initial}
                      </div>
                    )}
                    {isPaidPlan ? (
                      <span className="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#FDE3A1] px-2.5 py-0.5 text-[11px] font-semibold text-[#78590C] shadow-sm">
                        <Crown className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                        {planName}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-4 max-w-[9rem] text-xs leading-snug text-text-muted">
                    Explore more. Travel further.
                  </p>
                </div>

                <div
                  className="hidden w-px shrink-0 self-stretch bg-divider sm:block"
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-bold tracking-tight text-text">
                        {displayName}
                      </h2>
                      {email ? (
                        <p className="mt-0.5 truncate text-sm text-text-secondary">
                          {email}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        openMenu("account", AnalyticsEvents.ACCOUNT_OPENED)
                      }
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface hover:text-text"
                    >
                      <Pencil className="h-3 w-3" strokeWidth={2} aria-hidden />
                      Edit
                    </button>
                  </div>

                  <div className="mt-4">
                    <AiCreditsCard
                      balance={balance}
                      plan={plan}
                      onUpgrade={() => {
                        trackEvent(AnalyticsEvents.UPGRADE_CLICKED, {
                          plan,
                          source: "ai_credits_card",
                        });
                        router.push("/pricing");
                      }}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <StatButton
                      label="Countries"
                      value={stats.countries}
                      iconTone="green"
                      icon={<Globe2 className="h-4 w-4" strokeWidth={2} />}
                      onClick={() => openStat("countries")}
                    />
                    <StatButton
                      label="Places"
                      value={stats.places}
                      iconTone="blue"
                      icon={<MapPin className="h-4 w-4" strokeWidth={2} />}
                      onClick={() => openStat("places")}
                    />
                    <StatButton
                      label="Visited"
                      value={stats.visited}
                      iconTone="red"
                      icon={<Backpack className="h-4 w-4" strokeWidth={2} />}
                      onClick={() => openStat("visited")}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-divider px-5 py-3.5">
                <p className="text-xs italic text-text-muted">
                  “Collect moments, not things.”
                </p>
                <div className="flex shrink-0 items-center gap-1.5 text-text-secondary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/icon.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="h-4 w-4"
                  />
                  <span className="font-[family-name:var(--font-manrope)] text-[11px] font-semibold tracking-wide">
                    PinToTrip
                  </span>
                </div>
              </div>
            </section>

            <button
              type="button"
              onClick={() => {
                trackEvent(AnalyticsEvents.INVITE_OPENED);
                setInviteOpen(true);
              }}
              className="mt-4 flex w-full items-center gap-3.5 rounded-2xl border border-primary/20 bg-primary-tint px-4 py-4 text-left transition-colors hover:bg-primary-tint/80"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-sm">
                <Users className="h-5 w-5" strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text">
                  Invite friends
                </span>
                <span className="mt-0.5 block text-xs text-text-secondary">
                  Get {REFERRAL_REWARD_AI_CREDITS} AI credits when they join
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-white">
                Invite
              </span>
            </button>

            <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface-elevated">
              <ProfileMenuRow
                icon={<Globe2 className="h-4 w-4" />}
                title="Travel Preferences"
                description="Country, currency, language"
                onClick={() =>
                  openMenu(
                    "travel",
                    AnalyticsEvents.TRAVEL_PREFERENCES_OPENED
                  )
                }
              />
              <ProfileMenuRow
                icon={<FileText className="h-4 w-4" />}
                title="My Documents"
                description="Stored only on this device"
                onClick={() => setView("documents")}
              />
              <ProfileMenuRow
                icon={<CreditCard className="h-4 w-4" />}
                title="Subscription"
                description="Current plan and billing"
                onClick={() =>
                  openMenu("subscription", AnalyticsEvents.SUBSCRIPTION_OPENED)
                }
              />
              <ProfileMenuRow
                icon={<Settings className="h-4 w-4" />}
                title="Settings"
                description="Language, notifications, timezone"
                onClick={() =>
                  openMenu("settings", AnalyticsEvents.SETTINGS_OPENED)
                }
              />
            </div>

            <div className="mt-6">
              <LegalLinks onOpen={(page) => setView(page)} />
            </div>

            <Button
              color="error"
              icon={LogOut}
              onClick={() => void handleLogout()}
              className="mt-8 w-full"
            >
              Log out
            </Button>
          </>
        )}
      </div>

      <InviteFriendsSheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  );
}

const STAT_ICON_TONES = {
  green: "bg-success-background text-success",
  blue: "bg-[#EFF6FF] text-[#2563EB]",
  red: "bg-error-background text-error",
} as const;

function StatButton({
  label,
  value,
  icon,
  iconTone,
  onClick,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  iconTone: keyof typeof STAT_ICON_TONES;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface-elevated px-2.5 py-3 text-left transition-colors hover:bg-surface"
    >
      <span
        className={cx(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
          STAT_ICON_TONES[iconTone]
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <p className="text-lg font-bold tabular-nums leading-none text-text">
          {value}
        </p>
        <p className="mt-1 text-[11px] leading-none text-text-secondary">
          {label}
        </p>
      </span>
    </button>
  );
}
