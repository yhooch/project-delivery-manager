import { setRequestLocale } from "next-intl/server";

import { SpaceOverview } from "../../../../components/view/space-overview";
import type { Locale } from "../../../../i18n/locales";

type OverviewPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function OverviewRoutePage({ params }: OverviewPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <SpaceOverview />;
}
