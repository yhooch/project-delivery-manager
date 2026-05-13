import { setRequestLocale } from "next-intl/server";

import { WorkflowLanding } from "../../../../components/workflow/workflow-landing";
import type { Locale } from "../../../../i18n/locales";

type WorkflowPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function WorkflowPage({ params }: WorkflowPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <WorkflowLanding />;
}
