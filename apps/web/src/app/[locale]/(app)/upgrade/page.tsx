import { Suspense } from "react";

import { setRequestLocale } from "next-intl/server";

import { UpgradeCenterPage } from "../../../../components/upgrade/upgrade-center-page";
import type { Locale } from "../../../../i18n/locales";

type UpgradePageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function UpgradePage({ params }: UpgradePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={null}>
      <UpgradeCenterPage />
    </Suspense>
  );
}
