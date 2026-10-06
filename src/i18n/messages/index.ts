import type { MessageTree } from "../types";
import { normalizeUiLocale } from "../locales";
import { en } from "./en";
import { ru } from "./ru";
import { kz } from "./kz";

const catalogs: Record<string, MessageTree> = {
  en: en as unknown as MessageTree,
  ru: ru as unknown as MessageTree,
  kz: kz as unknown as MessageTree,
  // Browsers report Kazakh as ISO 639-1 `kk`.
  kk: kz as unknown as MessageTree,
};

export function getMessagesForLocale(locale: string): MessageTree {
  const code = normalizeUiLocale(locale);
  return catalogs[code] ?? (en as unknown as MessageTree);
}

export function registerMessages(locale: string, tree: MessageTree): void {
  catalogs[locale] = tree;
}

export { en, ru, kz };
