import { SITE_URL } from "@/features/legal";

const SCRIPTISH =
  /<(script|iframe|object|embed|link|meta|base)(\s[^>]*)?>[\s\S]*?<\/\1\s*>|<(script|iframe|object|embed|link|meta|base)(\s[^>]*)?\/?\s*>/gi;

const ON_ATTR = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const JS_HREF = /\s(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]+)/gi;

/**
 * Strip tags from a fragment (for titles / metadata).
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer explicit title, else first `<h1>` in HTML. */
export function resolveJournalTitle(
  html: string,
  explicitTitle?: string
): string {
  const fromField = explicitTitle?.trim();
  if (fromField) return fromField;

  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (match) {
    const text = stripHtml(match[1]);
    if (text) return text;
  }

  return "Untitled";
}

/** First paragraph after the title — used as the hero deck. */
export function extractJournalIntro(html: string): string | null {
  const withoutH1 = html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, "");
  const match = withoutH1.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (!match) return null;
  const text = stripHtml(match[1]);
  return text || null;
}

export type JournalTocItem = {
  id: string;
  title: string;
  index: number;
  /** First image in the section, if present. */
  imageUrl?: string;
  /** Short location / area line under the title. */
  subtitle?: string;
};

function isShortSubtitle(text: string): boolean {
  return text.length > 0 && text.length <= 48 && !text.includes(". ");
}

/** Section anchors from `<h2>` headings (section-1, section-2, …). */
export function extractJournalToc(html: string): JournalTocItem[] {
  if (typeof window !== "undefined") {
    return extractJournalTocFromDom(html);
  }

  const items: JournalTocItem[] = [];
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(html)) !== null) {
    const title = stripHtml(match[1]);
    if (!title) continue;
    index += 1;
    items.push({ id: `section-${index}`, title, index });
  }
  return items;
}

function extractJournalTocFromDom(html: string): JournalTocItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<div id="journal-toc-root">${html}</div>`,
    "text/html"
  );
  const root = doc.getElementById("journal-toc-root");
  if (!root) return [];

  const headings = Array.from(root.querySelectorAll("h2"));
  const items: JournalTocItem[] = [];

  headings.forEach((heading, i) => {
    const title = stripHtml(heading.innerHTML);
    if (!title) return;

    const index = i + 1;
    let imageUrl: string | undefined;
    let subtitle: string | undefined;

    let el: Element | null = heading.nextElementSibling;
    while (el && el.tagName !== "H2") {
      if (!imageUrl) {
        if (el.tagName === "IMG") {
          imageUrl = el.getAttribute("src")?.trim() || undefined;
        } else {
          const img = el.querySelector("img");
          imageUrl = img?.getAttribute("src")?.trim() || undefined;
        }
      }

      if (!subtitle) {
        const loc =
          el.matches(".location, .subtitle, [data-location]")
            ? el
            : el.querySelector(".location, .subtitle, [data-location]");
        if (loc) {
          const text = stripHtml(loc.innerHTML);
          if (text) subtitle = text;
        } else if (el.tagName === "P") {
          const text = stripHtml(el.innerHTML);
          if (isShortSubtitle(text)) subtitle = text;
        }
      }

      el = el.nextElementSibling;
    }

    items.push({
      id: `section-${index}`,
      title,
      index,
      ...(imageUrl ? { imageUrl } : {}),
      ...(subtitle ? { subtitle } : {}),
    });
  });

  return items;
}

/** Rough reading time from HTML word count (~220 wpm). */
export function estimateReadMinutes(html: string): number {
  const words = stripHtml(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function isExternalUrl(href: string, siteOrigin: string): boolean {
  try {
    if (
      href.startsWith("#") ||
      href.startsWith("/") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      return false;
    }
    const url = new URL(href, siteOrigin);
    const site = new URL(siteOrigin);
    return url.origin !== site.origin;
  } catch {
    return true;
  }
}

function isMapsUrl(href: string): boolean {
  try {
    const url = new URL(href, SITE_URL);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "maps.google.com" || host === "maps.app.goo.gl") return true;
    if (host === "google.com" || host.endsWith(".google.com")) {
      return url.pathname.includes("/maps");
    }
    return false;
  } catch {
    return /google\.com\/maps|maps\.google\.|maps\.app\.goo\.gl/i.test(href);
  }
}

function isPinToTripUrl(href: string): boolean {
  try {
    if (href.startsWith("/") && !href.startsWith("//")) return true;
    const url = new URL(href, SITE_URL);
    return (
      url.hostname === "pintototrip.app" ||
      url.hostname === "www.pintototrip.app" ||
      url.hostname.endsWith(".pintototrip.app")
    );
  } catch {
    return false;
  }
}

/**
 * Client-side HTML prep for journal bodies:
 * - strips dangerous tags / handlers
 * - lazy + responsive images
 * - safe external / maps links
 * - ids on h2 for TOC anchors
 * - keeps Tailwind class attributes intact
 */
export function prepareJournalHtml(
  rawHtml: string,
  options?: {
    siteOrigin?: string;
    stripLeadingH1?: boolean;
    stripLeadingIntro?: boolean;
  }
): string {
  if (typeof window === "undefined") {
    return sanitizeJournalHtmlString(rawHtml);
  }

  const siteOrigin = options?.siteOrigin ?? SITE_URL;
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<div id="journal-root">${rawHtml}</div>`,
    "text/html"
  );
  const root = doc.getElementById("journal-root");
  if (!root) return "";

  root
    .querySelectorAll("script, iframe, object, embed, link, meta, base")
    .forEach((el) => el.remove());

  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  if (options?.stripLeadingH1) {
    const first = root.querySelector("h1");
    if (first) first.remove();
  }

  if (options?.stripLeadingIntro) {
    const firstP = root.querySelector("p");
    if (firstP) firstP.remove();
  }

  let sectionIndex = 0;
  root.querySelectorAll("h2").forEach((heading) => {
    sectionIndex += 1;
    if (!heading.id) heading.id = `section-${sectionIndex}`;
  });

  root.querySelectorAll("img").forEach((img) => {
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    if (!img.getAttribute("alt")) img.setAttribute("alt", "");
    const existing = img.getAttribute("class") ?? "";
    if (!/\bjournal-img\b/.test(existing)) {
      img.setAttribute(
        "class",
        [existing, "journal-img"].filter(Boolean).join(" ")
      );
    }
  });

  root.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    if (!href || /^javascript:/i.test(href)) {
      anchor.removeAttribute("href");
      return;
    }

    const external = isExternalUrl(href, siteOrigin);
    const maps = isMapsUrl(href);
    const pinToTrip = isPinToTripUrl(href);

    if (external || maps) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }

    if (maps) {
      const cls = anchor.getAttribute("class") ?? "";
      if (!/\bjournal-maps-link\b/.test(cls)) {
        anchor.setAttribute(
          "class",
          [cls, "journal-maps-link"].filter(Boolean).join(" ")
        );
      }
    }

    if (pinToTrip) {
      const cls = anchor.getAttribute("class") ?? "";
      if (
        !/\bjournal-cta\b/.test(cls) &&
        /\bbtn|cta|button/i.test(cls + " " + (anchor.textContent ?? ""))
      ) {
        anchor.setAttribute(
          "class",
          [cls, "journal-cta"].filter(Boolean).join(" ")
        );
      }
    }
  });

  return root.innerHTML;
}

/** SSR-safe light sanitize (no DOM). */
export function sanitizeJournalHtmlString(html: string): string {
  return html
    .replace(SCRIPTISH, "")
    .replace(ON_ATTR, "")
    .replace(JS_HREF, "");
}
