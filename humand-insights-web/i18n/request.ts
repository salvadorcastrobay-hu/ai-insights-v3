import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const locales = ["es", "pt", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "es";

export default getRequestConfig(async () => {
  const jar = await cookies();
  const raw = jar.get("NEXT_LOCALE")?.value ?? defaultLocale;
  const locale = (locales as readonly string[]).includes(raw) ? (raw as Locale) : defaultLocale;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
