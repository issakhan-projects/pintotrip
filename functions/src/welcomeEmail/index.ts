import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { DEFAULT_FUNCTIONS_REGION, resendApiKey } from "../shared/config";
import { initAdmin } from "../shared/admin";
import {
  displayNameFromProfile,
  resolveFirstName,
} from "./firstName";
import { sendWelcomeEmail } from "./send";

/** Brand + email defaults (match src/features/legal/constants.ts). */
const APP_NAME = "PinToTrip";
const APP_URL = "https://pintototrip.app";
const CTA_URL = "https://pintototrip.app/login";
const LOGO_URL = "https://pintototrip.app/icon.png";
const EMAIL_FROM = `PinToTrip <support@pintototrip.app>`;

function readEmail(data: FirebaseFirestore.DocumentData | undefined): string {
  const raw = data?.email;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Firestore trigger: users/{userId} created → send welcome email via Resend.
 *
 * - Skips when the user has no email
 * - Never fails user creation: errors are logged and swallowed
 */
export const welcomeEmailOnUserCreated = onDocumentCreated(
  {
    document: "users/{userId}",
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [resendApiKey],
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    initAdmin();

    const userId = event.params.userId as string;
    const data = event.data?.data();

    const email = readEmail(data);
    if (!email) {
      logger.info("welcomeEmail skipped: no email on user profile", {
        userId,
      });
      return;
    }

    const displayName = displayNameFromProfile({
      name: data?.name,
      lastname: data?.lastname,
    });
    const firstName = resolveFirstName(displayName, email);

    try {
      const result = await sendWelcomeEmail({
        to: email,
        firstName,
        appName: APP_NAME,
        appUrl: APP_URL,
        ctaUrl: CTA_URL,
        logoUrl: LOGO_URL,
        from: EMAIL_FROM,
        apiKey: resendApiKey.value(),
      });

      logger.info("welcomeEmail sent", {
        userId,
        email,
        resendId: result.id,
      });
    } catch (err) {
      // Do not fail user creation / document write — log and continue.
      logger.error("welcomeEmail send failed; continuing", {
        userId,
        email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
