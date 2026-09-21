"use client";

/**
 * Floating “Complete your trip” checklist on the Itinerary page.
 * Progress is derived from routes + accommodations — nothing stored in Firestore.
 * Collapsed preference is a local flag (localStorage) per trip.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { cx } from "@/lib/utils";
import type {
  TripAccommodation,
  TripPlannerDoc,
  TripRoute,
} from "@/types/trip-planner";
import {
  createTripRoute,
  subscribeTripRoutes,
} from "@/services/trip-routes";
import { getTrip, updateTrip } from "@/services/trip-planner";
import { AccommodationSheet } from "./AccommodationSheet";
import { RouteSheet, type RouteSheetSavePayload } from "./RouteSheet";
import {
  applyAccommodationsToDestinations,
  listTripAccommodations,
  preparationWithoutLegacyAccommodation,
} from "./essentialsHelpers";
import {
  preparationInputFromTrip,
  syncTripPreparationItems,
} from "./buildPreparation";
import { nextRouteOrder } from "./routeHelpers";

type SetupStepId = "routes" | "accommodation";

type SetupStep = {
  id: SetupStepId;
  label: string;
  done: boolean;
};

function collapsedStorageKey(tripId: string) {
  return `trip-setup-checklist:collapsed:${tripId}`;
}

function readCollapsedFlag(tripId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(collapsedStorageKey(tripId)) === "1";
  } catch {
    return false;
  }
}

function writeCollapsedFlag(tripId: string, collapsed: boolean) {
  if (typeof window === "undefined") return;
  try {
    const key = collapsedStorageKey(tripId);
    if (collapsed) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function TripSetupChecklist({
  trip,
  userId,
}: {
  trip: TripPlannerDoc;
  userId: string;
}) {
  const [collapsed, setCollapsed] = useState(() => readCollapsedFlag(trip.id));
  const [dismissed, setDismissed] = useState(false);
  const [routes, setRoutes] = useState<TripRoute[]>([]);
  const [liveTrip, setLiveTrip] = useState(trip);
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [accommodationOpen, setAccommodationOpen] = useState(false);

  useEffect(() => {
    setLiveTrip(trip);
  }, [trip]);

  useEffect(() => {
    setCollapsed(readCollapsedFlag(trip.id));
  }, [trip.id]);

  function setCollapsedFlag(next: boolean) {
    setCollapsed(next);
    writeCollapsedFlag(trip.id, next);
  }

  useEffect(() => {
    const unsub = subscribeTripRoutes(
      userId,
      trip.id,
      (next) => setRoutes(next),
      () => setRoutes([])
    );
    return unsub;
  }, [userId, trip.id]);

  const accommodations = useMemo(
    () => listTripAccommodations(liveTrip),
    [liveTrip]
  );

  const steps: SetupStep[] = useMemo(() => {
    const routesDone = routes.length > 0;
    const accommodationDone = accommodations.length > 0;
    return [
      { id: "routes", label: "Add your routes", done: routesDone },
      {
        id: "accommodation",
        label: "Add accommodation",
        done: accommodationDone,
      },
    ];
  }, [routes.length, accommodations.length]);

  const completed = steps.filter((step) => step.done).length;
  const total = steps.length;
  const allDone = completed === total;
  const activeIndex = steps.findIndex((step) => !step.done);

  useEffect(() => {
    if (!allDone) setDismissed(false);
  }, [allDone]);

  if (dismissed) return null;

  async function openRouteSheet() {
    setRouteSheetOpen(true);
    try {
      const fresh = await getTrip(userId, trip.id, { hard: true });
      if (fresh) setLiveTrip(fresh);
    } catch {
      // Keep current liveTrip.
    }
  }

  async function handleSaveRoute(payload: RouteSheetSavePayload) {
    const { routeId, attachments, returnLeg, ...fields } = payload;
    const order = nextRouteOrder(routes);
    await createTripRoute(
      userId,
      {
        tripId: trip.id,
        order,
        ...fields,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      },
      routeId ? { id: routeId } : undefined
    );
    if (returnLeg) {
      const {
        routeId: returnRouteId,
        attachments: returnAttachments,
        ...returnFields
      } = returnLeg;
      await createTripRoute(
        userId,
        {
          tripId: trip.id,
          order: order + 1,
          ...returnFields,
          ...(returnAttachments && returnAttachments.length > 0
            ? { attachments: returnAttachments }
            : {}),
        },
        returnRouteId ? { id: returnRouteId } : undefined
      );
    }
    setRouteSheetOpen(false);
  }

  async function handleSaveAccommodations(items: TripAccommodation[]) {
    const destinations = applyAccommodationsToDestinations(liveTrip, items);
    const nextTrip = {
      ...liveTrip,
      destinations,
      preparation: preparationWithoutLegacyAccommodation(liveTrip.preparation),
    };
    const nextPreparation = {
      ...preparationWithoutLegacyAccommodation(liveTrip.preparation),
      items: syncTripPreparationItems(
        liveTrip.preparation.items,
        preparationInputFromTrip(nextTrip)
      ),
    };
    await updateTrip(userId, trip.id, {
      destinations,
      preparation: nextPreparation,
    });
    setLiveTrip((prev) => ({
      ...prev,
      destinations,
      preparation: nextPreparation,
    }));
    setAccommodationOpen(false);
  }

  function handleStepClick(step: SetupStep) {
    if (step.id === "routes") void openRouteSheet();
    else setAccommodationOpen(true);
  }

  return (
    <>
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsedFlag(false)}
          className={cx(
            "pointer-events-auto fixed bottom-4 right-4 z-40",
            "inline-flex items-center gap-2 rounded-full border border-border bg-white",
            "px-3 py-2 shadow-lg transition-colors hover:bg-surface"
          )}
          aria-expanded={false}
          aria-label={`Complete your trip, ${completed} of ${total} done`}
        >
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="text-xs font-semibold text-text">Setup</span>
          <span className="flex items-center gap-1.5" aria-hidden>
            <span className="flex items-end gap-0.5">
              {Array.from({ length: total }, (_, index) => (
                <span
                  key={index}
                  className={cx(
                    "h-2.5 w-[2.5px] rounded-full",
                    index < completed ? "bg-success" : "bg-border"
                  )}
                />
              ))}
            </span>
            <span className="text-[11px] font-medium tabular-nums text-text-secondary">
              {completed}/{total}
            </span>
          </span>
        </button>
      ) : (
        <div
          className={cx(
            "pointer-events-auto fixed bottom-4 right-4 z-40 w-[min(calc(100vw-2rem),22rem)]",
            "overflow-hidden rounded-2xl border border-border bg-white shadow-lg"
          )}
        >
          <button
            type="button"
            onClick={() => setCollapsedFlag(true)}
            className="flex w-full items-center gap-2.5 bg-surface px-3.5 py-3 text-left"
            aria-expanded
          >
            <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 text-sm font-semibold text-text">
              Complete your trip
            </span>
            <span className="flex items-center gap-2" aria-hidden>
              <span className="flex items-end gap-0.5">
                {Array.from({ length: total }, (_, index) => (
                  <span
                    key={index}
                    className={cx(
                      "h-3.5 w-[3px] rounded-full",
                      index < completed ? "bg-success" : "bg-border"
                    )}
                  />
                ))}
              </span>
              <span className="text-xs font-medium tabular-nums text-text-secondary">
                {completed}/{total}
              </span>
            </span>
          </button>

          {allDone ? (
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm font-semibold text-text">
                <span className="mr-1.5 text-success" aria-hidden>
                  ✓
                </span>
                Trip setup complete
              </p>
              <p className="text-sm leading-relaxed text-text-secondary">
                Routes and accommodation are ready for a more accurate
                itinerary.
              </p>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-xs font-medium text-text-muted hover:text-text"
              >
                Dismiss
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-divider px-1.5 py-1">
              {steps.map((step, index) => {
                const isActive = index === activeIndex;
                const number = index + 1;
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      onClick={() => handleStepClick(step)}
                      className="flex w-full items-center gap-3 px-2.5 py-3 text-left transition-colors hover:bg-surface"
                    >
                      {step.done ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-white">
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                      ) : (
                        <span
                          className={cx(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                            isActive
                              ? "bg-text text-white"
                              : "bg-divider text-text-secondary"
                          )}
                        >
                          {number}
                        </span>
                      )}
                      <span
                        className={cx(
                          "min-w-0 flex-1 text-sm font-medium",
                          step.done ? "text-text-muted" : "text-text"
                        )}
                      >
                        {step.label}
                      </span>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-text-muted"
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <RouteSheet
        open={routeSheetOpen}
        onClose={() => setRouteSheetOpen(false)}
        trip={liveTrip}
        userId={userId}
        editing={null}
        onSave={handleSaveRoute}
      />

      <AccommodationSheet
        open={accommodationOpen}
        onClose={() => setAccommodationOpen(false)}
        trip={liveTrip}
        items={accommodations}
        startInForm={accommodations.length === 0}
        onSaveAll={handleSaveAccommodations}
      />
    </>
  );
}
