"use client";

import { useEffect, useState } from "react";
import {
  CloudSun,
  Droplets,
  Loader2,
  RefreshCw,
  Wind,
} from "lucide-react";
import type { TripPlannerDoc } from "@/types/trip-planner";
import type { GetTripWeatherResult, TripWeatherDay } from "@/types/weather";
import { getTripWeather } from "@/services/functions";
import { startOfUtcDay } from "@/services/trip-planner";
import { cx } from "@/lib/utils";
import { primaryTripDestination } from "./tripDestinations";

function toIsoDate(date: Date): string {
  const d = startOfUtcDay(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function unitSymbol(units: "metric" | "imperial"): string {
  return units === "imperial" ? "°F" : "°C";
}

function windUnit(units: "metric" | "imperial"): string {
  return units === "imperial" ? "mph" : "m/s";
}

function weatherIconUrl(icon: string): string {
  return `https://openweathermap.org/img/wn/${icon}@2x.png`;
}

interface TripWeatherBlockProps {
  trip: TripPlannerDoc;
}

export function TripWeatherBlock({ trip }: TripWeatherBlockProps) {
  const [data, setData] = useState<GetTripWeatherResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primary = primaryTripDestination(trip);

  const lat = primary.lat;
  const lon = primary.lon;
  const hasCoords = lat != null && lon != null;

  async function load() {
    if (lat == null || lon == null) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getTripWeather({
        lat,
        lon,
        startDate: toIsoDate(trip.startDate.toDate()),
        endDate: toIsoDate(trip.endDate.toDate()),
        units: "metric",
        cityName: primary.cityName,
      });
      setData(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load weather."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!hasCoords) return;
    void load();
    // Reload when destination or dates change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional trip field deps
  }, [
    hasCoords,
    lat,
    lon,
    trip.startDate?.toMillis?.(),
    trip.endDate?.toMillis?.(),
    primary.cityName,
  ]);

  if (!hasCoords) {
    return (
      <section className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
        <Header />
        <p className="mt-3 text-sm text-text-secondary">
          Add destination coordinates to see a day-by-day forecast.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <Header cityName={primary.cityName} />
        <button
          type="button"
          aria-label="Refresh weather"
          disabled={loading}
          onClick={() => void load()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl bg-error-background px-3 py-2 text-sm text-error">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <div className="mt-4 flex items-center justify-center gap-2 py-8 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Loading forecast…
        </div>
      ) : null}

      {data ? (
        <>
          <div className="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {data.days.map((day) => (
              <DayCard
                key={day.date}
                day={day}
                units={data.units}
              />
            ))}
          </div>
          {data.note ? (
            <p className="mt-3 text-xs text-text-muted">{data.note}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Header({ cityName }: { cityName?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
        <CloudSun className="h-4 w-4" />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-text">Weather by day</h3>
        <p className="text-xs text-text-secondary">
          {cityName
            ? `Forecast for ${cityName}`
            : "Forecast for your destination"}
        </p>
      </div>
    </div>
  );
}

function DayCard({
  day,
  units,
}: {
  day: TripWeatherDay;
  units: "metric" | "imperial";
}) {
  const deg = unitSymbol(units);

  return (
    <div
      className={cx(
        "w-[112px] shrink-0 rounded-2xl border px-3 py-3",
        day.available
          ? "border-border bg-surface"
          : "border-dashed border-border/80 bg-surface/60"
      )}
    >
      <p className="text-[11px] font-medium text-text-secondary">
        {formatDayLabel(day.date)}
      </p>

      {day.available ? (
        <>
          <div className="mt-1 flex items-center gap-1">
            {day.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={weatherIconUrl(day.icon)}
                alt=""
                className="h-10 w-10 -ml-1"
              />
            ) : (
              <CloudSun className="my-2 h-8 w-8 text-sky-600" />
            )}
          </div>
          <p className="text-lg font-semibold tabular-nums text-text">
            {day.temp != null ? Math.round(day.temp) : "—"}
            {deg}
          </p>
          <p className="mt-0.5 text-[11px] tabular-nums text-text-secondary">
            {day.tempMin != null && day.tempMax != null
              ? `${Math.round(day.tempMin)}° / ${Math.round(day.tempMax)}°`
              : "—"}
          </p>
          {day.description ? (
            <p className="mt-1 line-clamp-2 text-[11px] capitalize leading-snug text-text-secondary">
              {day.description}
            </p>
          ) : null}
          <div className="mt-2 space-y-1 text-[10px] text-text-muted">
            {day.precipitationChance != null ? (
              <p className="flex items-center gap-1">
                <Droplets className="h-3 w-3" />
                {day.precipitationChance}%
              </p>
            ) : null}
            {day.windSpeed != null ? (
              <p className="flex items-center gap-1">
                <Wind className="h-3 w-3" />
                {day.windSpeed} {windUnit(units)}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-4 text-xs leading-snug text-text-muted">
          Forecast not available yet
        </p>
      )}
    </div>
  );
}
