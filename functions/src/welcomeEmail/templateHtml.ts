import { escapeHtml } from "./escapeHtml";

export type WelcomeEmailHtmlVars = {
  firstName: string;
  appName: string;
  appUrl: string;
  ctaUrl: string;
  logoUrl: string;
  /** Inbox preview / preheader text */
  previewText: string;
};

/**
 * Responsive, table-based HTML welcome email.
 * Keep styles inline for email client compatibility.
 */
export function buildWelcomeEmailHtml(vars: WelcomeEmailHtmlVars): string {
  const firstName = escapeHtml(vars.firstName);
  const appName = escapeHtml(vars.appName);
  const appUrl = escapeHtml(vars.appUrl);
  const ctaUrl = escapeHtml(vars.ctaUrl);
  const logoUrl = vars.logoUrl.trim();
  const previewText = escapeHtml(vars.previewText);

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="36" height="36" alt="" style="display:block;border:0;outline:none;text-decoration:none;border-radius:8px;" />`
    : `<div style="width:36px;height:36px;border-radius:8px;background-color:#1a1a1a;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:36px;text-align:center;">${appName.charAt(0) || "A"}</div>`;

  const steps = [
    "Finish your profile so the experience fits you",
    "Add your first item and start building momentum",
    "Choose one focus for today",
    "Come back tomorrow — small steps compound",
  ];

  const stepRows = steps
    .map((step, index) => {
      const n = index + 1;
      return `
                      <tr>
                        <td style="padding:0 0 14px 0;vertical-align:top;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                            <tr>
                              <td width="36" valign="top" style="padding-right:12px;">
                                <div style="width:28px;height:28px;border-radius:14px;background-color:#f0f0ee;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;line-height:28px;text-align:center;">${n}</div>
                              </td>
                              <td valign="middle" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#333333;">
                                ${escapeHtml(step)}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Welcome to ${appName}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f5f5f3;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f5f5f3;opacity:0;">
    ${previewText}
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f3;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:12px;vertical-align:middle;">
                    ${logoBlock}
                  </td>
                  <td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:24px;color:#1a1a1a;">
                    ${appName}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Eyebrow + Title + Intro -->
          <tr>
            <td style="padding:20px 32px 8px 32px;">
              <p style="margin:0 0 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.12em;line-height:16px;color:#6b6b66;text-transform:uppercase;">
                WELCOME
              </p>
              <h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;line-height:34px;color:#1a1a1a;">
                Welcome to ${appName}
              </h1>
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#333333;">
                Hi ${firstName},
              </p>
              <p style="margin:12px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#333333;">
                Thanks for creating your account. ${appName} helps you capture what matters and make steady progress — without the clutter.
              </p>
            </td>
          </tr>

          <!-- Start simple -->
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <h2 style="margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;line-height:24px;color:#1a1a1a;">
                Start simple
              </h2>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${stepRows}
              </table>
            </td>
          </tr>

          <!-- Quote -->
          <tr>
            <td style="padding:16px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f7f7f5;border-radius:8px;">
                <tr>
                  <td style="padding:20px 24px;border-left:3px solid #1a1a1a;">
                    <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:16px;font-style:italic;line-height:26px;color:#333333;">
                      “The secret of getting ahead is getting started.”
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:24px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#1a1a1a" style="border-radius:8px;">
                    <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;">
                      Get started
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Closing -->
          <tr>
            <td style="padding:28px 32px 32px 32px;">
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#333333;">
                We're glad you're here.
              </p>
              <p style="margin:16px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#333333;">
                — The ${appName} team
              </p>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="padding:24px 16px 8px 16px;text-align:center;">
              <p style="margin:0 0 6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6b6b66;">
                <a href="${appUrl}" style="color:#6b6b66;text-decoration:underline;">${appName}</a>
              </p>
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8a8a85;">
                This is a transactional welcome email related to your account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
