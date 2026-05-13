import { setRequestLocale } from "next-intl/server";

import { WorkItemLanding } from "../../../../components/work-item/work-item-landing";
import type { Locale } from "../../../../i18n/locales";

type WorkItemsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function WorkItemsPage({ params }: WorkItemsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <WorkItemLanding />;
}
