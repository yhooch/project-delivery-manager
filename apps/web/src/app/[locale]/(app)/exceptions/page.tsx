import { Suspense } from "react";

import { setRequestLocale } from "next-intl/server";

import { ExceptionsPage } from "../../../../components/exception/exceptions-page";
import type { Locale } from "../../../../i18n/locales";

type ExceptionsRoutePageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function ExceptionsRoutePage({
  params,
}: ExceptionsRoutePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={null}>
      <ExceptionsPage />
    </Suspense>
  );
}
