"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { SearchableSelect } from "@/components/ui";
import {
  COUNTRY_OPTIONS,
  countryNameFromCode,
  resolveCountryCode,
} from "@/lib/countries";
import { CURRENCY_OPTIONS, resolveCurrencyCode } from "@/lib/currencies";
import { LANGUAGE_OPTIONS, resolveLanguageCode } from "@/lib/languages";
import { updateUserProfile } from "@/services/users";
import type { UserProfile } from "@/types/user";
import { Save } from "lucide-react";

const COUNTRY_SELECT_OPTIONS = COUNTRY_OPTIONS.map((c) => ({
  value: c.code,
  label: c.label,
}));

const CURRENCY_SELECT_OPTIONS = CURRENCY_OPTIONS.map((c) => ({
  value: c.code,
  label: c.label,
}));

const LANGUAGE_SELECT_OPTIONS = LANGUAGE_OPTIONS.map((l) => ({
  value: l.code,
  label: l.label,
}));

interface TravelPreferencesViewProps {
  userId: string;
  profile: UserProfile;
  onSaved: () => void;
}

export function TravelPreferencesView({
  userId,
  profile,
  onSaved,
}: TravelPreferencesViewProps) {
  const [countryCode, setCountryCode] = useState(() =>
    resolveCountryCode(profile.country)
  );
  const [currency, setCurrency] = useState(() =>
    resolveCurrencyCode(profile.currency)
  );
  const [language, setLanguage] = useState(() =>
    resolveLanguageCode(profile.preferences?.language)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Keep pickers in sync with the latest saved profile values.
  useEffect(() => {
    setCountryCode(resolveCountryCode(profile.country));
    setCurrency(resolveCurrencyCode(profile.currency));
    setLanguage(resolveLanguageCode(profile.preferences?.language));
  }, [profile.country, profile.currency, profile.preferences?.language]);

  const countryOptions =
    countryCode && !COUNTRY_SELECT_OPTIONS.some((o) => o.value === countryCode)
      ? [
          {
            value: countryCode,
            label: profile.country?.trim() || countryCode,
          },
          ...COUNTRY_SELECT_OPTIONS,
        ]
      : COUNTRY_SELECT_OPTIONS;

  const currencyOptions =
    currency && !CURRENCY_SELECT_OPTIONS.some((o) => o.value === currency)
      ? [
          {
            value: currency,
            label: profile.currency?.trim() || currency,
          },
          ...CURRENCY_SELECT_OPTIONS,
        ]
      : CURRENCY_SELECT_OPTIONS;

  const languageOptions =
    language && !LANGUAGE_SELECT_OPTIONS.some((o) => o.value === language)
      ? [
          {
            value: language,
            label: profile.preferences?.language?.trim() || language,
          },
          ...LANGUAGE_SELECT_OPTIONS,
        ]
      : LANGUAGE_SELECT_OPTIONS;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateUserProfile(userId, {
        country: countryNameFromCode(countryCode) || countryCode,
        currency: currency || undefined,
        preferences: {
          emailSubscription: profile.preferences?.emailSubscription ?? true,
          language: language || "en",
          timezone:
            profile.preferences?.timezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save preferences."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Home base details used to personalize your travel experience.
      </p>

      <Field label="Home country">
        <SearchableSelect
          value={countryCode}
          onChange={setCountryCode}
          options={countryOptions}
          placeholder="Select a country…"
          searchPlaceholder="Search countries…"
          clearable
        />
      </Field>

      <Field label="Currency">
        <SearchableSelect
          value={currency}
          onChange={setCurrency}
          options={currencyOptions}
          placeholder="Select a currency…"
          searchPlaceholder="Search currencies…"
          clearable
        />
      </Field>

      <Field label="Language">
        <SearchableSelect
          value={language}
          onChange={setLanguage}
          options={languageOptions}
          placeholder="Select a language…"
          searchPlaceholder="Search languages…"
          clearable
        />
      </Field>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {saved ? (
        <p className="text-sm text-success">Preferences saved.</p>
      ) : null}

      <Button
        color="primary"
        icon={Save}
        loading={saving}
        onClick={() => void handleSave()}
        className="w-full"
      >
        Save
      </Button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
    </div>
  );
}
