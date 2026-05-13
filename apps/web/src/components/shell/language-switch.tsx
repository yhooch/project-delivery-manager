"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import type { Locale } from "../../i18n/locales";
import { locales } from "../../i18n/locales";
import { usePathname, useRouter } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";

export function LanguageSwitch() {
  const t = useTranslations("common.language");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const { persistPreferences, session } = useSession();
  const [isPending, startTransition] = useTransition();

  function changeLocale(nextLocale: Locale) {
    if (nextLocale === locale) {
      return;
    }

    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });

      if (session) {
        void persistPreferences({ locale: nextLocale });
      }
    });
  }

  return (
    <div className="language-switch" role="group" aria-label={t("label")}>
      <Languages aria-hidden="true" size={16} strokeWidth={2} />
      {locales.map((option) => {
        const isActive = option === locale;

        return (
          <button
            aria-label={t(`${option}.ariaLabel`)}
            aria-pressed={isActive}
            className="language-switch__button"
            disabled={isPending}
            key={option}
            onClick={() => changeLocale(option)}
            type="button"
          >
            {t(`${option}.shortLabel`)}
          </button>
        );
      })}
    </div>
  );
}
