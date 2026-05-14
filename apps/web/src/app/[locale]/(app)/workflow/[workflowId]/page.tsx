import { setRequestLocale } from "next-intl/server";

import { WorkflowConfigPage } from "../../../../../components/workflow/workflow-config-page";
import type { Locale } from "../../../../../i18n/locales";

type WorkflowConfigRoutePageProps = {
  params: Promise<{
    locale: Locale;
    workflowId: string;
  }>;
};

export default async function WorkflowConfigRoutePage({
  params,
}: WorkflowConfigRoutePageProps) {
  const { locale, workflowId } = await params;
  setRequestLocale(locale);

  return <WorkflowConfigPage workflowId={workflowId} />;
}
