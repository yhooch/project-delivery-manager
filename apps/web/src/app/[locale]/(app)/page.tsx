import { setRequestLocale } from "next-intl/server";

import { MyWorkbench } from "../../../components/workbench/my-workbench";
import type { Locale } from "../../../i18n/locales";

type DashboardPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <MyWorkbench />;
}
