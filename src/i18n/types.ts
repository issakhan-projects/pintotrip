/** Nested message tree — leaf values are English (or translated) strings. */
export type MessageTree = { [key: string]: string | MessageTree };

export type LocaleCode = string;

export type TranslateParams = Record<string, string | number | null | undefined>;

export type TranslateFn = (key: string, params?: TranslateParams) => string;
