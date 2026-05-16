import { Suspense } from "react";

import { setRequestLocale } from "next-intl/server";

import { RequirementsPage } from "../../../../components/requirement/requirements-page";
import type { Locale } from "../../../../i18n/locales";

type RequirementsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function RequirementsRoutePage({
  params,
}: RequirementsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={null}>
      <RequirementsPage />
    </Suspense>
  );
}
