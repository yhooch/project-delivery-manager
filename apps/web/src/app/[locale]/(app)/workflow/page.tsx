import { setRequestLocale } from "next-intl/server";

import { WorkflowPage } from "../../../../components/workflow/workflow-page";
import type { Locale } from "../../../../i18n/locales";

type WorkflowPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function WorkflowRoutePage({ params }: WorkflowPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <WorkflowPage />;
}
