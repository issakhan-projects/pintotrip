declare module "country-flag-select" {
  export interface Country {
    code: string;
    name: string;
  }

  export const COUNTRIES: Country[];
  export function getFlagEmoji(code: string): string;
}

declare module "country-flag-select/react" {
  import type { CSSProperties, ReactElement } from "react";

  export type ValueType = "short" | "long";
  export type FlagType = "emoji" | "image" | "none";
  export type Theme = "auto" | "light" | "dark";

  export interface CountryFlagSelectProps {
    placeholder?: string;
    searchPlaceholder?: string;
    multi?: boolean;
    value?: string | string[] | null;
    valueType?: ValueType;
    flagType?: FlagType;
    imageUrl?: string;
    searchable?: boolean;
    maxItems?: number | null;
    onChange?: (value: string | string[] | null) => void;
    countries?: { code: string; name: string }[];
    include?: string[];
    exclude?: string[];
    disabled?: boolean;
    clearable?: boolean;
    theme?: Theme;
    className?: string;
    style?: CSSProperties;
  }

  export function CountryFlagSelect(
    props: CountryFlagSelectProps
  ): ReactElement;

  export default CountryFlagSelect;
}
