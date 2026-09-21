import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type CollectionReference,
  type DocumentReference,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import type {
  TripRoute,
  TripRouteCreateInput,
  TripRouteUpdateInput,
} from "@/types/trip-planner";
import { deleteStorageObject } from "@/services/storage";

function routesCollection(
  userId: string,
  tripId: string
): CollectionReference {
  return collection(
    getFirestoreDb(),
    FirestorePaths.tripRoutes(userId, tripId)
  );
}

function routeRef(
  userId: string,
  tripId: string,
  routeId: string
): DocumentReference {
  return doc(
    getFirestoreDb(),
    FirestorePaths.tripRoute(userId, tripId, routeId)
  );
}

/** Firestore rejects `undefined` anywhere in payloads. */
function omitUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefinedDeep(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    if (
      typeof (value as { toMillis?: unknown }).toMillis === "function" ||
      value instanceof Date
    ) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (entry === undefined) continue;
      out[key] = omitUndefinedDeep(entry);
    }
    return out as T;
  }
  return value;
}

function mapDoc(d: QueryDocumentSnapshot): TripRoute {
  const data = d.data() as Omit<TripRoute, "id">;
  return {
    ...data,
    id: d.id,
  };
}

export function subscribeTripRoutes(
  userId: string,
  tripId: string,
  onChange: (routes: TripRoute[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(routesCollection(userId, tripId), orderBy("order", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      onChange(snapshot.docs.map(mapDoc));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function listTripRoutes(
  userId: string,
  tripId: string
): Promise<TripRoute[]> {
  const q = query(routesCollection(userId, tripId), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(mapDoc);
}

export function allocateTripRouteId(userId: string, tripId: string): string {
  return doc(routesCollection(userId, tripId)).id;
}

export async function createTripRoute(
  userId: string,
  input: TripRouteCreateInput,
  options?: { id?: string }
): Promise<string> {
  const ref = options?.id
    ? doc(routesCollection(userId, input.tripId), options.id)
    : doc(routesCollection(userId, input.tripId));
  await setDoc(
    ref,
    omitUndefinedDeep({
      ...input,
      id: ref.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  return ref.id;
}

export async function updateTripRoute(
  userId: string,
  tripId: string,
  routeId: string,
  patch: TripRouteUpdateInput
): Promise<void> {
  await updateDoc(
    routeRef(userId, tripId, routeId),
    omitUndefinedDeep({
      ...patch,
      updatedAt: serverTimestamp(),
    })
  );
}

export async function deleteTripRoute(
  userId: string,
  tripId: string,
  routeId: string
): Promise<void> {
  await deleteDoc(routeRef(userId, tripId, routeId));
}

/**
 * Delete every route doc under a trip (and best-effort attachment files).
 * Firestore does not cascade subcollections when the parent trip is deleted.
 */
export async function deleteAllTripRoutes(
  userId: string,
  tripId: string
): Promise<void> {
  const snap = await getDocs(routesCollection(userId, tripId));
  if (snap.empty) return;

  // Best-effort Storage cleanup from attachment metadata on each route.
  await Promise.all(
    snap.docs.map(async (routeDoc) => {
      const attachments = (routeDoc.data() as TripRoute).attachments;
      if (!Array.isArray(attachments) || attachments.length === 0) return;
      await Promise.all(
        attachments.map(async (file) => {
          if (!file?.storagePath) return;
          try {
            await deleteStorageObject(file.storagePath);
          } catch {
            // Ignore missing/unavailable objects.
          }
        })
      );
    })
  );

  const db = getFirestoreDb();
  const docs = snap.docs;
  const CHUNK = 450;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const routeDoc of docs.slice(i, i + CHUNK)) {
      batch.delete(routeDoc.ref);
    }
    await batch.commit();
  }
}
