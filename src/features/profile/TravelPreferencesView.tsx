"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { SearchableSelect } from "@/components/ui";
import { LanguageMenu } from "@/components/LanguageMenu";
import { useI18n } from "@/i18n";
import { normalizeUiLocale, type UiLocaleCode } from "@/i18n/locales";
import {
  COUNTRY_OPTIONS,
  countryNameFromCode,
  resolveCountryCode,
} from "@/lib/countries";
import { CURRENCY_OPTIONS, resolveCurrencyCode } from "@/lib/currencies";
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
  const { t } = useI18n();
  const [countryCode, setCountryCode] = useState(() =>
    resolveCountryCode(profile.country)
  );
  const [currency, setCurrency] = useState(() =>
    resolveCurrencyCode(profile.currency)
  );
  const [language, setLanguage] = useState<UiLocaleCode>(() =>
    normalizeUiLocale(profile.preferences?.language)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Keep pickers in sync with the latest saved profile values.
  useEffect(() => {
    setCountryCode(resolveCountryCode(profile.country));
    setCurrency(resolveCurrencyCode(profile.currency));
    setLanguage(normalizeUiLocale(profile.preferences?.language));
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
          language,
          timezone:
            profile.preferences?.timezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          temperatureUnit: profile.preferences?.temperatureUnit ?? "celsius",
          distanceUnit: profile.preferences?.distanceUnit ?? "km",
          timeFormat: profile.preferences?.timeFormat ?? "24h",
        },
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("profile.prefs.saveError")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">{t("profile.prefs.intro")}</p>

      <Field label={t("profile.prefs.homeCountry")}>
        <SearchableSelect
          value={countryCode}
          onChange={setCountryCode}
          options={countryOptions}
          placeholder={t("profile.prefs.selectCountry")}
          searchPlaceholder={t("profile.prefs.searchCountries")}
          clearable
        />
      </Field>

      <Field label={t("profile.prefs.currency")}>
        <SearchableSelect
          value={currency}
          onChange={setCurrency}
          options={currencyOptions}
          placeholder={t("profile.prefs.selectCurrency")}
          searchPlaceholder={t("profile.prefs.searchCurrencies")}
          clearable
        />
      </Field>

      <LanguageMenu variant="field" onLocaleChange={setLanguage} />

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {saved ? (
        <p className="text-sm text-success">{t("profile.prefs.saved")}</p>
      ) : null}

      <Button
        color="primary"
        icon={Save}
        loading={saving}
        onClick={() => void handleSave()}
        className="w-full"
      >
        {t("common.save")}
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
