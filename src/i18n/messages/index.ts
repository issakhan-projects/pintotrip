import type { MessageTree } from "../types";
import { en } from "./en";

const catalogs: Record<string, MessageTree> = {
  en: en as unknown as MessageTree,
};

export function getMessagesForLocale(locale: string): MessageTree {
  const code = locale.trim().toLowerCase().split(/[-_]/)[0] || "en";
  return catalogs[code] ?? (en as unknown as MessageTree);
}

export function registerMessages(locale: string, tree: MessageTree): void {
  catalogs[locale] = tree;
}

export { en };
