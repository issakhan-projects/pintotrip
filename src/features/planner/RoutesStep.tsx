"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  MoreVertical,
  Pencil,
  Plus,
  Route,
  Trash2,
} from "lucide-react";
import { Button, DeleteConfirmModal } from "@/components/ui";
import { cx } from "@/lib/utils";
import type {
  TripAccommodation,
  TripPlannerDoc,
  TripRoute,
  TripRouteStatus,
} from "@/types/trip-planner";
import type { LocationStatus } from "@/types/location";
import {
  createTripRoute,
  deleteTripRoute,
  subscribeTripRoutes,
  updateTripRoute,
} from "@/services/trip-routes";
import { getTrip, updateTrip } from "@/services/trip-planner";
import type { SavedLocation } from "@/hooks/useLocations";
import { PlaceDetailSheet } from "@/features/places/PlaceDetailSheet";
import { RouteLegCard } from "./RouteLegCard";
import { RouteSheet, type RouteSheetSavePayload } from "./RouteSheet";
import { RoutesTimeline } from "./RoutesTimeline";
import { nextRouteOrder } from "./routeHelpers";
import {
  applyAccommodationsToDestinations,
  preparationWithoutLegacyAccommodation,
} from "./essentialsHelpers";
import {
  preparationInputFromTrip,
  syncTripPreparationItems,
} from "./buildPreparation";

type RoutesTab = "edit" | "timeline";

const TABS: Array<{ id: RoutesTab; label: string }> = [
  { id: "edit", label: "Edit" },
  { id: "timeline", label: "Timeline" },
];

function RouteCard({
  route,
  menuOpen,
  onToggleMenu,
  onEdit,
  onToggleDone,
  onDelete,
}: {
  route: TripRoute;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onToggleDone: () => void;
  onDelete: () => void;
}) {
  const done = route.status === "done";
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null
  );

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = 140;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < menuHeight && rect.top > menuHeight;
      setMenuPos({
        top: openUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      onToggleMenu();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, onToggleMenu]);

  const menu =
    menuOpen && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[80] min-w-[10.5rem] rounded-xl border border-border bg-white py-1 shadow-lg"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center font-medium gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5 text-text-muted" />
              Edit route
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center font-medium gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
              onClick={onToggleDone}
            >
              <Check className="h-3.5 w-3.5 text-text-muted" />
              {done ? "Mark as planned" : "Mark as done"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center font-medium gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error-background"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete route
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <li>
      <RouteLegCard
        route={route}
        actions={
          <div className="relative">
            <button
              ref={buttonRef}
              type="button"
              aria-label="Route actions"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={onToggleMenu}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface hover:text-text"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menu}
          </div>
        }
      />
    </li>
  );
}

export function RoutesStep({
  trip,
  userId,
  locations = [],
  onMarkPlaceStatus,
  onSavePlaceNote,
}: {
  trip: TripPlannerDoc;
  userId: string;
  locations?: SavedLocation[];
  onMarkPlaceStatus?: (
    locationId: string,
    status: LocationStatus
  ) => Promise<void>;
  onSavePlaceNote?: (locationId: string, note: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<RoutesTab>("edit");
  const [routes, setRoutes] = useState<TripRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<TripRoute | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TripRoute | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewPlace, setPreviewPlace] = useState<SavedLocation | null>(null);
  /** Fresh trip doc so `transport.airports` isn’t stuck on a stale cache. */
  const [liveTrip, setLiveTrip] = useState(trip);

  useEffect(() => {
    setLiveTrip(trip);
  }, [trip]);

  useEffect(() => {
    let cancelled = false;
    void getTrip(userId, trip.id, { hard: true })
      .then((fresh) => {
        if (!cancelled && fresh) setLiveTrip(fresh);
      })
      .catch(() => {
        // Keep prop trip — offline / permission errors.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, trip.id]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsub = subscribeTripRoutes(
      userId,
      trip.id,
      (next) => {
        setRoutes(next);
        setLoading(false);
      },
      (err) => {
        setError(err.message || "Failed to load routes.");
        setLoading(false);
      }
    );
    return unsub;
  }, [userId, trip.id]);

  async function openSheet(route: TripRoute | null) {
    setEditing(route);
    setMenuOpenId(null);
    setSheetOpen(true);
    try {
      const fresh = await getTrip(userId, trip.id, { hard: true });
      if (fresh) setLiveTrip(fresh);
    } catch {
      // Keep current liveTrip.
    }
  }

  function openAdd() {
    void openSheet(null);
  }

  function openAddFromTimeline() {
    setTab("edit");
    void openSheet(null);
  }

  function openEdit(route: TripRoute) {
    void openSheet(route);
  }

  async function handleSave(payload: RouteSheetSavePayload) {
    const { routeId, attachments, returnLeg, ...fields } = payload;
    if (editing) {
      await updateTripRoute(userId, trip.id, editing.id, {
        transport: fields.transport,
        from: fields.from,
        to: fields.to,
        departure: fields.departure,
        arrival: fields.arrival,
        durationMinutes: fields.durationMinutes,
        durationApproximate: fields.durationApproximate,
        status: fields.status,
        note: fields.note ?? "",
        airline:
          fields.transport === "flight" ? (fields.airline ?? "") : "",
        flightNumber:
          fields.transport === "flight" ? (fields.flightNumber ?? "") : "",
        attachments: attachments ?? [],
      });
      return;
    }
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
  }

  async function handleToggleDone(route: TripRoute) {
    setMenuOpenId(null);
    const nextStatus: TripRouteStatus =
      route.status === "done" ? "planned" : "done";
    await updateTripRoute(userId, trip.id, route.id, { status: nextStatus });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTripRoute(userId, trip.id, deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
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
  }

  return (
    <section
      className={cx(
        "mx-auto w-full",
        tab === "timeline" ? "max-w-[1120px]" : "max-w-[1080px]"
      )}
    >
      <div className="rounded-2xl bg-white">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary">
                <Route className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="text-lg font-semibold text-text">Routes</h2>
            </div>
            <p className="mt-1 text-sm text-text-secondary sm:pl-[2.875rem]">
              Plan and manage how you move between destinations.
            </p>
          </div>
          <div
            role="tablist"
            aria-label="Routes views"
            className="grid w-full grid-cols-2 gap-1 rounded-xl bg-surface p-1 sm:w-56"
          >
            {TABS.map((item) => {
              const selected = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(item.id)}
                  className={cx(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    selected
                      ? "bg-white text-primary shadow-sm ring-1 ring-border"
                      : "text-text-secondary hover:text-text"
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6" role="tabpanel">
          {tab === "timeline" ? (
            <RoutesTimeline
              trip={liveTrip}
              routes={routes}
              locations={locations}
              loading={loading}
              error={error}
              onAddRoute={openAddFromTimeline}
              onEditRoute={openEdit}
              onOpenPlace={(locationId) => {
                const place = locations.find((loc) => loc.id === locationId);
                if (place) setPreviewPlace(place);
              }}
              onSaveAccommodations={handleSaveAccommodations}
            />
          ) : (
            <>
              <div className="mb-5 flex items-center justify-end">
                <Button
                  type="button"
                  variant="primary"
                  icon={Plus}
                  onClick={openAdd}
                  className="!h-10"
                >
                  Add route
                </Button>
              </div>

              {error ? (
                <p className="rounded-xl bg-error-background px-4 py-3 text-sm text-error">
                  {error}
                </p>
              ) : null}

              {loading ? (
                <p className="py-10 text-center text-sm text-text-secondary">
                  Loading routes…
                </p>
              ) : routes.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface/60 px-6 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-tint text-primary">
                    <Route className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-text">
                    Plan your journey
                  </h3>
                  <p className="mt-1.5 max-w-sm text-sm text-text-secondary">
                    Add your first route to build your trip timeline.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    icon={Plus}
                    className="mt-5 !h-10"
                    onClick={openAdd}
                  >
                    Add route
                  </Button>
                </div>
              ) : (
                <ul className="flex list-none flex-col gap-3 p-0">
                  {routes.map((route) => (
                    <RouteCard
                      key={route.id}
                      route={route}
                      menuOpen={menuOpenId === route.id}
                      onToggleMenu={() =>
                        setMenuOpenId((id) =>
                          id === route.id ? null : route.id
                        )
                      }
                      onEdit={() => openEdit(route)}
                      onToggleDone={() => void handleToggleDone(route)}
                      onDelete={() => {
                        setMenuOpenId(null);
                        setDeleteTarget(route);
                      }}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <RouteSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setEditing(null);
        }}
        trip={liveTrip}
        userId={userId}
        editing={editing}
        onSave={handleSave}
      />

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        entity="route"
        description="This removes the route from your trip. This can’t be undone."
        loading={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />

      <PlaceDetailSheet
        place={previewPlace}
        open={Boolean(previewPlace)}
        onClose={() => setPreviewPlace(null)}
        onUpdateStatus={async (status) => {
          if (!previewPlace || !onMarkPlaceStatus) return;
          await onMarkPlaceStatus(previewPlace.id, status);
          setPreviewPlace({ ...previewPlace, status });
        }}
        onSaveNote={async (note) => {
          if (!previewPlace || !onSavePlaceNote) return;
          await onSavePlaceNote(previewPlace.id, note);
          setPreviewPlace({ ...previewPlace, note });
        }}
      />
    </section>
  );
}
