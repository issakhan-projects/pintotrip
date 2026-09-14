import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
  type Unsubscribe,
  type UserCredential,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/auth";
import { detectUserLocation } from "@/lib/maps/detectLocation";
import { ensureUserProfile } from "@/services/users";

/** Firebase Auth error code thrown when email/password login is blocked. */
export const EMAIL_NOT_VERIFIED_CODE = "auth/email-not-verified";

function emailNotVerifiedError(): Error {
  const error = new Error(
    "Please verify your email before signing in. Check your inbox for the link."
  );
  Object.assign(error, { code: EMAIL_NOT_VERIFIED_CODE });
  return error;
}

/** Password-provider accounts must verify email before using the app. */
export function isUnverifiedPasswordUser(user: User): boolean {
  const usesPassword = user.providerData.some(
    (provider) => provider.providerId === "password"
  );
  return usesPassword && !user.emailVerified;
}

export interface EmailPasswordCredentials {
  email: string;
  password: string;
}

export interface SignUpWithEmailParams extends EmailPasswordCredentials {
  displayName?: string;
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
googleProvider.addScope("profile");
googleProvider.addScope("email");

/**
 * Start geolocation during the click turn (before any await) so browsers
 * show the permission prompt. Never block profile creation on it — waiting
 * lets auth-state redirects unmount the login UI before users/{uid} exists.
 */
function startLocationDetection(): Promise<
  Awaited<ReturnType<typeof detectUserLocation>>
> {
  return detectUserLocation();
}

async function createProfileNow(
  user: User,
  displayName?: string | null
): Promise<void> {
  await ensureUserProfile({
    userId: user.uid,
    email: user.email,
    displayName: displayName ?? user.displayName,
    photoUrl: user.photoURL,
    location: null,
  });
}

/** Best-effort location write after the profile already exists. */
function backfillLocationLater(
  user: User,
  locationPromise: Promise<Awaited<ReturnType<typeof detectUserLocation>>>,
  displayName?: string | null
): void {
  void locationPromise
    .then(async (location) => {
      if (!location) return;
      await ensureUserProfile({
        userId: user.uid,
        email: user.email,
        displayName: displayName ?? user.displayName,
        photoUrl: user.photoURL,
        location,
      });
    })
    .catch(() => {
      // Location is optional; profile already exists.
    });
}

export async function signUpWithEmail({
  email,
  password,
  displayName,
}: SignUpWithEmailParams): Promise<UserCredential> {
  const locationPromise = startLocationDetection();
  const auth = getFirebaseAuth();
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  if (displayName && credential.user) {
    await updateProfile(credential.user, { displayName });
  }

  await createProfileNow(credential.user, displayName);

  // Apply location before sign-out while the session is still valid.
  const location = await locationPromise;
  if (location) {
    await ensureUserProfile({
      userId: credential.user.uid,
      email: credential.user.email,
      displayName: displayName ?? credential.user.displayName,
      photoUrl: credential.user.photoURL,
      location,
    });
  }

  await sendEmailVerification(credential.user);
  // Keep the account created but signed out until they verify.
  await signOut(getFirebaseAuth());

  return credential;
}

export async function signInWithEmail({
  email,
  password,
}: EmailPasswordCredentials): Promise<UserCredential> {
  const locationPromise = startLocationDetection();
  const credential = await signInWithEmailAndPassword(
    getFirebaseAuth(),
    email,
    password
  );

  if (isUnverifiedPasswordUser(credential.user)) {
    await signOut(getFirebaseAuth());
    throw emailNotVerifiedError();
  }

  await createProfileNow(credential.user);
  backfillLocationLater(credential.user, locationPromise);

  return credential;
}

export async function signInWithGoogle(): Promise<UserCredential> {
  const locationPromise = startLocationDetection();
  const credential = await signInWithPopup(
    getFirebaseAuth(),
    googleProvider
  );

  // Profile is created inside /map (with progress UI). Best-effort kickoff here.
  void createProfileNow(credential.user).catch((err) => {
    console.error("[signInWithGoogle] profile create", err);
  });
  backfillLocationLater(credential.user, locationPromise);

  return credential;
}

export async function logout(): Promise<void> {
  await signOut(getFirebaseAuth());
}

export function subscribeToAuthState(
  callback: (user: User | null) => void
): Unsubscribe {
  return onAuthStateChanged(getFirebaseAuth(), callback);
}

export function getCurrentUser(): User | null {
  return getFirebaseAuth().currentUser;
}

export type { User, UserCredential, Unsubscribe };
