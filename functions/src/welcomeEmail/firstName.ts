/**
 * Resolve a greeting first name for welcome emails.
 *
 * Priority:
 * 1. First word of display name (valid, no `@`, max 40 chars)
 * 2. Email local-part before `.` `_` `+` `-`, capitalized
 * 3. Fallback: `there`
 */

const MAX_FIRST_NAME_LENGTH = 40;

function isValidDisplayFirstWord(word: string): boolean {
  if (!word || word.length > MAX_FIRST_NAME_LENGTH) return false;
  if (word.includes("@")) return false;
  return true;
}

function capitalizeLocalPart(segment: string): string {
  if (!segment) return "";
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

/**
 * Build a display name from profile fields (name + lastname).
 */
export function displayNameFromProfile(fields: {
  name?: unknown;
  lastname?: unknown;
}): string {
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const lastname =
    typeof fields.lastname === "string" ? fields.lastname.trim() : "";
  return [name, lastname].filter(Boolean).join(" ");
}

export function resolveFirstName(
  displayName: string | null | undefined,
  email: string | null | undefined
): string {
  const trimmedDisplay = (displayName ?? "").trim();
  if (trimmedDisplay) {
    const firstWord = trimmedDisplay.split(/\s+/)[0] ?? "";
    if (isValidDisplayFirstWord(firstWord)) {
      return firstWord;
    }
  }

  const trimmedEmail = (email ?? "").trim();
  const at = trimmedEmail.indexOf("@");
  if (at > 0) {
    const local = trimmedEmail.slice(0, at);
    const segment = local.split(/[._+-]/)[0] ?? "";
    if (segment && segment.length <= MAX_FIRST_NAME_LENGTH) {
      return capitalizeLocalPart(segment);
    }
  }

  return "there";
}
