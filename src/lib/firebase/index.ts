export { getFirebaseConfig, hasPublicEnvConfigured } from "./config";
export { getFirebaseApp } from "./client";
export { getFirebaseAuth } from "./auth";
export {
  getFirestoreDb,
  getFirestorePersistenceMode,
  FirestorePaths,
} from "./firestore";
export { getFirebaseStorage, StoragePaths } from "./storage";
export {
  initRealtimeVisibilityPause,
  setRealtimeSyncFromPlan,
  setRealtimeSyncEnabled,
  isRealtimeSyncEnabled,
  subscribeRealtimeSyncMode,
  bindRealtimeAwareSubscription,
  getRealtimeSyncSnapshot,
} from "./realtime-sync";
export type { RealtimeSyncMode, RealtimeSyncSnapshot } from "./realtime-sync";
export {
  getFirestoreDebugCounters,
  resetFirestoreDebugCounters,
} from "./debug";
