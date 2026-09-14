export type WelcomeEmailTextVars = {
  firstName: string;
  appName: string;
  appUrl: string;
  ctaUrl: string;
};

/** Plain-text fallback for the welcome email. */
export function buildWelcomeEmailText(vars: WelcomeEmailTextVars): string {
  const { firstName, appName, appUrl, ctaUrl } = vars;

  return [
    `Hi ${firstName},`,
    "",
    `Welcome to ${appName}`,
    "",
    `Thanks for creating your account. ${appName} helps you capture what matters and make steady progress — without the clutter.`,
    "",
    "Start simple",
    "1. Finish your profile so the experience fits you",
    "2. Add your first item and start building momentum",
    "3. Choose one focus for today",
    "4. Come back tomorrow — small steps compound",
    "",
    '"The secret of getting ahead is getting started."',
    "",
    `Get started: ${ctaUrl}`,
    "",
    "We're glad you're here.",
    "",
    `— The ${appName} team`,
    "",
    "---",
    `${appName}`,
    appUrl,
    "This is a transactional welcome email related to your account.",
  ].join("\n");
}
