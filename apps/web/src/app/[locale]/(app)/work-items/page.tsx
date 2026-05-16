import { Suspense } from "react";

import { setRequestLocale } from "next-intl/server";

import { TasksPage } from "../../../../components/work-item/tasks-page";
import type { Locale } from "../../../../i18n/locales";

type WorkItemsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function WorkItemsPage({ params }: WorkItemsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={null}>
      <TasksPage />
    </Suspense>
  );
}
