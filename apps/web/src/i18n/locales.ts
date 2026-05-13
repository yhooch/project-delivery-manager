export const locales = ["zh-CN", "en-US"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";

export function isLocale(value: string | undefined): value is Locale {
  return locales.some((locale) => locale === value);
}
