"use client";

import { useEffect, useState } from "react";
import { Button, Switch, TextInput } from "@/components/ui";
import { updateUserProfile } from "@/services/users";
import type { UserProfile } from "@/types/user";
import { Save } from "lucide-react";

interface SettingsViewProps {
  userId: string;
  profile: UserProfile;
  onSaved: () => void;
}

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
