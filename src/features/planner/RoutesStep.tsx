"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Route,
  Trash2,
} from "lucide-react";
import { Button, DeleteConfirmModal } from "@/components/ui";
import { cx } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type {
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
import { getTrip } from "@/services/trip-planner";
import type { SavedLocation } from "@/hooks/useLocations";
import { RouteLegCard } from "./RouteLegCard";
import { RouteSheet, type RouteSheetSavePayload } from "./RouteSheet";
import { nextRouteOrder } from "./routeHelpers";

function RouteCard({
  route,
  index,
  menuOpen,
  onToggleMenu,
  onEdit,
  onToggleDone,
  onDelete,
}: {
  route: TripRoute;
  index: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onToggleDone: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
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
            className="fixed z-[80] min-w-[11rem] overflow-hidden rounded-2xl border border-border bg-white py-1 shadow-lg ring-1 ring-black/5"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-text transition-colors hover:bg-surface"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5 text-text-muted" aria-hidden />
              {t("planner.routes.editRoute")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-text transition-colors hover:bg-surface"
              onClick={onToggleDone}
            >
              <Check className="h-3.5 w-3.5 text-text-muted" aria-hidden />
              {done
                ? t("planner.routes.markPlanned")
                : t("planner.routes.markDone")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-error transition-colors hover:bg-error-background"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t("planner.routes.deleteRoute")}
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <li className="transition-transform duration-200 hover:-translate-y-0.5">
      <RouteLegCard
        route={route}
        index={index}
        actions={
          <div className="relative">
            <button
              ref={buttonRef}
              type="button"
              aria-label={t("planner.routes.actionsAria")}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={onToggleMenu}
              className={cx(
                "inline-flex h-8 w-8 items-center justify-center rounded-xl transition-colors",
                "border border-primary/25 text-primary hover:bg-primary-tint",
                "sm:border-transparent sm:text-text-secondary sm:hover:bg-surface sm:hover:text-text"
              )}
            >
              <Pencil className="h-3.5 w-3.5 sm:hidden" aria-hidden />
              <MoreVertical className="hidden h-4 w-4 sm:block" aria-hidden />
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
  locations: _locations = [],
  onMarkPlaceStatus: _onMarkPlaceStatus,
  onSavePlaceNote: _onSavePlaceNote,
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
  const { t } = useI18n();
  const [routes, setRoutes] = useState<TripRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<TripRoute | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TripRoute | null>(null);
  const [deleting, setDeleting] = useState(false);
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
        setError(err.message || t("planner.routes.loadError"));
        setLoading(false);
      }
    );
    return unsub;
  }, [userId, trip.id, t]);

  const doneCount = useMemo(
    () => routes.filter((route) => route.status === "done").length,
    [routes]
  );
  const leftCount = Math.max(0, routes.length - doneCount);
  const percent =
    routes.length > 0 ? Math.round((doneCount / routes.length) * 100) : 0;
  const allDone = routes.length > 0 && percent === 100;

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
        // null clears a previously saved fare when the field is emptied.
        priceAmount: fields.priceAmount ?? null,
        priceCurrency: fields.priceCurrency ?? null,
        priceLabel: fields.priceLabel ?? null,
      } as Parameters<typeof updateTripRoute>[3]);
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {t("planner.routes.title")}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            {t("planner.routes.subtitle")}
          </p>
        </div>
        <Button
          type="button"
          color="primary"
          icon={Plus}
          onClick={openAdd}
          className="shrink-0 self-start sm:self-auto"
        >
          {t("planner.routes.add")}
        </Button>
      </div>

      <section className="relative overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-primary-tint via-surface-elevated to-surface p-5 shadow-sm sm:p-6">
        <div
          className="pointer-events-none absolute -top-16 -right-10 h-44 w-44 rounded-full bg-primary/10 blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-primary-light/10 blur-3xl"
          aria-hidden
        />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-primary uppercase shadow-sm ring-1 ring-primary/10">
                <Route className="h-3.5 w-3.5" aria-hidden />
                {t("planner.routes.progressLabel")}
              </span>
              {allDone ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-background px-2.5 py-1 text-[11px] font-semibold text-success ring-1 ring-success/15">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                  {t("planner.routes.allSet")}
                </span>
              ) : null}
            </div>

            <p className="mt-3 text-3xl font-semibold tracking-tight text-text tabular-nums sm:text-4xl">
              {routes.length > 0 ? `${percent}%` : "—"}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {routes.length > 0
                ? t("planner.routes.progressDone", {
                    done: doneCount,
                    total: routes.length,
                  })
                : t("planner.routes.progressEmpty")}
            </p>
          </div>

          {routes.length > 0 ? (
            <div className="grid min-w-0 grid-cols-3 gap-2 sm:min-w-[18rem]">
              <StatChip
                label={t("planner.routes.statTotal")}
                value={String(routes.length)}
                tone="neutral"
              />
              <StatChip
                label={t("planner.routes.statDone")}
                value={String(doneCount)}
                tone="done"
              />
              <StatChip
                label={t("planner.routes.statLeft")}
                value={String(leftCount)}
                tone="left"
              />
            </div>
          ) : null}
        </div>

        {routes.length > 0 ? (
          <div className="relative mt-5 h-2.5 overflow-hidden rounded-full bg-white/70 ring-1 ring-border/60">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-tint text-primary">
              <Route className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text">
                  {t("planner.routes.title")}
                </h3>
                {routes.length > 0 ? (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-secondary ring-1 ring-border">
                    {doneCount}/{routes.length}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-sm font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("planner.routes.add")}
          </button>
        </div>

        {error ? (
          <p className="mb-4 rounded-2xl bg-error-background px-4 py-3 text-sm text-error">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/70 px-4 py-14 text-center">
            <Loader2
              className="h-5 w-5 animate-spin text-primary"
              aria-hidden
            />
            <p className="mt-3 text-sm text-text-secondary">
              {t("planner.routes.loading")}
            </p>
          </div>
        ) : routes.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface/70 px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-tint text-primary shadow-sm ring-1 ring-primary/10">
              <Route className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="mt-4 text-base font-semibold text-text">
              {t("planner.routes.emptyTitle")}
            </h3>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-secondary">
              {t("planner.routes.emptyBody")}
            </p>
            <Button
              type="button"
              color="primary"
              icon={Plus}
              className="mt-5"
              onClick={openAdd}
            >
              {t("planner.routes.add")}
            </Button>
          </div>
        ) : (
          <ul className="flex list-none flex-col gap-3.5 rounded-2xl bg-surface/60 p-2.5 sm:gap-4 sm:p-3">
            {routes.map((route, routeIndex) => (
              <RouteCard
                key={route.id}
                route={route}
                index={routeIndex + 1}
                menuOpen={menuOpenId === route.id}
                onToggleMenu={() =>
                  setMenuOpenId((id) => (id === route.id ? null : route.id))
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

        {!loading && routes.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            icon={Plus}
            className="mt-4 w-full"
            onClick={openAdd}
          >
            {t("planner.routes.add")}
          </Button>
        ) : null}
      </section>

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
        description={t("planner.routes.deleteDesc")}
        loading={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "done" | "left";
}) {
  return (
    <div
      className={cx(
        "rounded-2xl px-3 py-2.5 shadow-sm ring-1 backdrop-blur-sm",
        tone === "done"
          ? "bg-white/90 ring-success/15"
          : "bg-white/75 ring-border/70"
      )}
    >
      <p className="text-[10px] font-semibold tracking-wide text-text-muted uppercase">
        {label}
      </p>
      <p
        className={cx(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "done" ? "text-success" : "text-text"
        )}
      >
        {value}
      </p>
    </div>
  );
}
