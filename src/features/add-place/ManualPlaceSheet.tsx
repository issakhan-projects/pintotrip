"use client";

import { useState } from "react";
import { Button, TextInput } from "@/components/ui";
import { Timestamp } from "firebase/firestore";
import { Sheet } from "@/components/ui/Sheet";
import { createUserLocation } from "@/services/locations";
import { slugifyId, countryIdFromParts, isAsciiId } from "@/lib/utils";
import { resolveCountryCode } from "@/lib/countries";
import { resolveEnglishPlaceIds, withCityGooglePlaceId } from "@/lib/maps";

interface ManualPlaceSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  coords: { lat: number; lng: number } | null;
  onSaved: () => void;
}

export function ManualPlaceSheet({
  open,
  onClose,
  userId,
  coords,
  onSaved,
}: ManualPlaceSheetProps) {
  const [title, setTitle] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!coords || !title.trim() || !city.trim() || !country.trim()) {
      setError("Title, city, and country are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const countryName = country.trim();
      const cityName = city.trim();
      // Localized names slugify to "unknown" — resolve English/ASCII ids from coords.
      const englishIds = await resolveEnglishPlaceIds(coords.lat, coords.lng);
      const countryCode =
        englishIds?.countryCode ||
        resolveCountryCode(countryName) ||
        undefined;
      const countryData = {
        id: countryIdFromParts(
          englishIds?.countryNameEn || countryName,
          countryCode
        ),
        name: countryName,
      };
      const cityId =
        (englishIds?.cityId && isAsciiId(englishIds.cityId)
          ? englishIds.cityId
          : null) ||
        (isAsciiId(slugifyId(englishIds?.cityNameEn || ""))
          ? slugifyId(englishIds!.cityNameEn)
          : null) ||
        (isAsciiId(slugifyId(cityName)) ? slugifyId(cityName) : null);
      if (!isAsciiId(countryData.id) || !cityId) {
        throw new Error(
          "Could not resolve English city/country ids for this place. Try again."
        );
      }
      const cityData = await withCityGooglePlaceId(
        { id: cityId, name: cityName },
        countryData,
        { lat: coords.lat, lon: coords.lng }
      );
      const noteText = note.trim();
      await createUserLocation(userId, {
        title: title.trim(),
        description: noteText || "Added manually from the map.",
        ...(noteText ? { note: noteText } : {}),
        lat: coords.lat,
        lon: coords.lng,
        country: countryData,
        city: cityData,
        status: "planned",
        images: [],
        confidence: 1,
        ai: {
          why: "Manually placed by the user on the map.",
          model: "manual",
          processedAt: Timestamp.now(),
        },
        source: { type: "manual" },
      });
      setTitle("");
      setCity("");
      setCountry("");
      setNote("");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save place.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Save place" size="md">
      <div className="flex flex-col gap-3">
        {coords ? (
          <p className="text-xs text-text-muted">
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </p>
        ) : null}
        <TextInput
          placeholder="Place title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextInput
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <TextInput
          placeholder="Country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        />
        <TextInput
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error ? <p className="text-sm text-error">{error}</p> : null}
        <Button
          loading={saving}
          onClick={() => void handleSave()}
          className="!bg-primary hover:!bg-primary-hover !border-primary !text-white"
        >
          Save place
        </Button>
      </div>
    </Sheet>
  );
}
