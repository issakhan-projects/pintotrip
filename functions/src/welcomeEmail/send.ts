import { logger } from "firebase-functions";
import { renderWelcomeEmail } from "./render";

export type SendWelcomeEmailParams = {
  to: string;
  firstName: string;
  appName: string;
  appUrl: string;
  ctaUrl: string;
  logoUrl: string;
  /** Full From header, e.g. `Acme <support@example.com>` */
  from: string;
  apiKey: string;
};

export type SendWelcomeEmailResult = {
  id: string;
};

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Send the welcome email via Resend HTTP API.
 * Throws on non-2xx so callers can log and continue.
 */
export async function sendWelcomeEmail(
  params: SendWelcomeEmailParams
): Promise<SendWelcomeEmailResult> {
  const { to, firstName, appName, appUrl, ctaUrl, logoUrl, from, apiKey } =
    params;

  const rendered = renderWelcomeEmail({
    firstName,
    appName,
    appUrl,
    ctaUrl,
    logoUrl,
  });

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "pin-to-trip-functions/1.0",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    }),
  });

  const bodyText = await response.text();
  let parsed: { id?: string; message?: string; name?: string } = {};
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    // non-JSON error body
  }

  if (!response.ok) {
    const detail =
      parsed.message || parsed.name || bodyText || response.statusText;
    logger.error("Resend welcome email failed", {
      status: response.status,
      detail,
      to,
    });
    throw new Error(`Resend API error (${response.status}): ${detail}`);
  }

  if (!parsed.id) {
    throw new Error("Resend API returned success without an email id.");
  }

  return { id: parsed.id };
}
