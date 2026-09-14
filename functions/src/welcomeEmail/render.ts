import { buildWelcomeEmailHtml } from "./templateHtml";
import { buildWelcomeEmailText } from "./templateText";

export type RenderWelcomeEmailInput = {
  firstName: string;
  appName: string;
  appUrl: string;
  ctaUrl: string;
  logoUrl: string;
};

export type RenderedWelcomeEmail = {
  subject: string;
  previewText: string;
  html: string;
  text: string;
};

const PREVIEW_TEXT =
  "You're in — here's a quick way to get started.";

/**
 * Inject personalization + brand placeholders into HTML and plain-text bodies.
 */
export function renderWelcomeEmail(
  input: RenderWelcomeEmailInput
): RenderedWelcomeEmail {
  const { firstName, appName, appUrl, ctaUrl, logoUrl } = input;

  return {
    subject: `Welcome to ${appName}`,
    previewText: PREVIEW_TEXT,
    html: buildWelcomeEmailHtml({
      firstName,
      appName,
      appUrl,
      ctaUrl,
      logoUrl,
      previewText: PREVIEW_TEXT,
    }),
    text: buildWelcomeEmailText({
      firstName,
      appName,
      appUrl,
      ctaUrl,
    }),
  };
}
