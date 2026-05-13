import { setRequestLocale } from "next-intl/server";

import { IntakeLanding } from "../../../../components/intake/intake-landing";
import type { Locale } from "../../../../i18n/locales";

type IntakeItemsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function IntakeItemsPage({ params }: IntakeItemsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <IntakeLanding />;
}
