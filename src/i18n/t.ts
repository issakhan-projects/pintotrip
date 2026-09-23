import type { MessageTree, TranslateParams } from "./types";

/** Resolve a dotted key against a nested message tree. */
export function lookupMessage(
  tree: MessageTree,
  key: string
): string | undefined {
  const parts = key.split(".");
  let cur: string | MessageTree | undefined = tree;
  for (const part of parts) {
    if (cur == null || typeof cur === "string") return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Replace `{name}` placeholders. Missing params stay as `{name}`. */
export function interpolate(
  template: string,
  params?: TranslateParams
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value == null) return match;
    return String(value);
  });
}

export function createTranslator(
  primary: MessageTree,
  fallback: MessageTree
): (key: string, params?: TranslateParams) => string {
  return (key, params) => {
    const raw =
      lookupMessage(primary, key) ??
      lookupMessage(fallback, key) ??
      key;
    return interpolate(raw, params);
  };
}
