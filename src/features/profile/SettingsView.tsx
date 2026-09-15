"use client";

import { useEffect, useState } from "react";
import { Button, Switch, TextInput } from "@/components/ui";
import { updateUserProfile } from "@/services/users";
import type {
  DistanceUnit,
  TemperatureUnit,
  TimeFormat,
  UserProfile,
} from "@/types/user";
import { Save } from "lucide-react";
import { cx } from "@/lib/utils";

interface SettingsViewProps {
  userId: string;
  profile: UserProfile;
  onSaved: () => void;
}

const TEMPERATURE_OPTIONS: Array<{ value: TemperatureUnit; label: string }> = [
  { value: "celsius", label: "°C" },
  { value: "fahrenheit", label: "°F" },
];

const DISTANCE_OPTIONS: Array<{ value: DistanceUnit; label: string }> = [
  { value: "km", label: "km" },
  { value: "mi", label: "mi" },
];

const TIME_FORMAT_OPTIONS: Array<{ value: TimeFormat; label: string }> = [
  { value: "24h", label: "24" },
  { value: "12h", label: "12" },
];

export function SettingsView({ userId, profile, onSaved }: SettingsViewProps) {
  const [language, setLanguage] = useState(
    profile.preferences?.language ?? "en"
  );
  const [timezone, setTimezone] = useState(
    profile.preferences?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [emailSubscription, setEmailSubscription] = useState(
    profile.preferences?.emailSubscription ?? true
  );
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>(
    profile.preferences?.temperatureUnit ?? "celsius"
  );
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(
    profile.preferences?.distanceUnit ?? "km"
  );
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(
    profile.preferences?.timeFormat ?? "24h"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLanguage(profile.preferences?.language ?? "en");
    setTimezone(
      profile.preferences?.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone
    );
    setEmailSubscription(profile.preferences?.emailSubscription ?? true);
    setTemperatureUnit(profile.preferences?.temperatureUnit ?? "celsius");
    setDistanceUnit(profile.preferences?.distanceUnit ?? "km");
    setTimeFormat(profile.preferences?.timeFormat ?? "24h");
  }, [profile]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateUserProfile(userId, {
        preferences: {
          language: language.trim() || "en",
          timezone: timezone.trim() || "UTC",
          emailSubscription,
          temperatureUnit,
          distanceUnit,
          timeFormat,
        },
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save settings."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3">
        <div>
          <p className="text-sm font-medium text-text">Email notifications</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Occasional product updates and tips
          </p>
        </div>
        <Switch
          checked={emailSubscription}
          onChange={setEmailSubscription}
        />
      </div>

      <Field label="Timezone">
        <TextInput
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Asia/Almaty"
        />
      </Field>

      <UnitField
        label="Temperature"
        options={TEMPERATURE_OPTIONS}
        value={temperatureUnit}
        onChange={setTemperatureUnit}
      />

      <UnitField
        label="Distance"
        options={DISTANCE_OPTIONS}
        value={distanceUnit}
        onChange={setDistanceUnit}
      />

      <UnitField
        label="Time format"
        options={TIME_FORMAT_OPTIONS}
        value={timeFormat}
        onChange={setTimeFormat}
      />

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {saved ? <p className="text-sm text-success">Settings saved.</p> : null}

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

function UnitField<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-text">{label}</p>
      <div
        className="grid grid-cols-2 rounded-xl bg-surface p-1"
        role="group"
        aria-label={label}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={selected}
              className={cx(
                "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                selected
                  ? "bg-surface-elevated text-primary shadow-sm"
                  : "text-text-secondary hover:text-text"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
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
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
    </label>
  );
}
