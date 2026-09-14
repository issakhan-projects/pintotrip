"use client";

import { useEffect, useRef, useState } from "react";
import { Button, TextInput } from "@/components/ui";
import { Camera } from "lucide-react";
import { updateProfile } from "firebase/auth";
import type { User } from "firebase/auth";
import { updateUserProfile } from "@/services/users";
import { uploadProfileAvatar } from "@/services/storage";
import {
  IMAGE_FILE_ACCEPT,
  imageUploadErrorMessage,
  prepareClientImage,
} from "@/lib/images";
import type { UserProfile } from "@/types/user";

interface AccountViewProps {
  user: User;
  profile: UserProfile;
  onSaved: () => void;
}

export function AccountView({ user, profile, onSaved }: AccountViewProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile.name ?? "");
  const [lastname, setLastname] = useState(profile.lastname ?? "");
  const [photoUrl, setPhotoUrl] = useState(
    profile.photoUrl || user.photoURL || ""
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const emailEditable = user.providerData.some(
    (p) => p.providerId === "password"
  );

  useEffect(() => {
    setName(profile.name ?? "");
    setLastname(profile.lastname ?? "");
    setPhotoUrl(profile.photoUrl || user.photoURL || "");
  }, [profile, user.photoURL]);

  async function handlePhotoChange(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const prepared = await prepareClientImage(file, {
        maxSides: [512, 384],
        qualities: [0.82, 0.68, 0.52, 0.4],
        maxDataUrlChars: 600_000,
      });
      const url = await uploadProfileAvatar(user.uid, prepared.blob, {
        contentType: "image/jpeg",
      });
      await updateUserProfile(user.uid, { photoUrl: url });
      await updateProfile(user, { photoURL: url });
      setPhotoUrl(url);
      onSaved();
    } catch (err) {
      setError(imageUploadErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const nextName = name.trim() || "Traveler";
      const nextLast = lastname.trim();
      await updateUserProfile(user.uid, {
        name: nextName,
        lastname: nextLast,
      });
      const displayName = [nextName, nextLast].filter(Boolean).join(" ");
      await updateProfile(user, { displayName });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save account."
      );
    } finally {
      setSaving(false);
    }
  }

  const initial = (name || "T").charAt(0).toUpperCase();

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="relative"
          aria-label="Change profile photo"
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-24 w-24 rounded-full object-cover ring-2 ring-primary-tint"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-tint text-3xl font-semibold text-primary">
              {initial}
            </div>
          )}
          <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow">
            <Camera className="h-4 w-4" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            void handlePhotoChange(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <p className="mt-2 text-xs text-text-secondary">
          {uploading ? "Uploading…" : "Tap to change photo"}
        </p>
      </div>

      <Field label="First name">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sabit"
        />
      </Field>

      <Field label="Last name">
        <TextInput
          value={lastname}
          onChange={(e) => setLastname(e.target.value)}
          placeholder="Issakhan"
        />
      </Field>

      <Field label="Email">
        <TextInput value={user.email ?? profile.email ?? ""} disabled />
        <p className="mt-1.5 text-xs text-text-muted">
          {emailEditable
            ? "Email is managed through your sign-in credentials."
            : "Email comes from your sign-in provider and can’t be edited here."}
        </p>
      </Field>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {saved ? <p className="text-sm text-success">Account saved.</p> : null}

      <Button
        loading={saving}
        onClick={() => void handleSave()}
        className="btn-primary w-full"
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
