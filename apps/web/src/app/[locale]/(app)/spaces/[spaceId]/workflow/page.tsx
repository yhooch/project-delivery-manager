import { setRequestLocale } from "next-intl/server";

import { WorkflowWorkspace } from "../../../../../../components/workflow/workflow-workspace";
import type { Locale } from "../../../../../../i18n/locales";

type SpaceWorkflowPageProps = {
  params: Promise<{
    locale: Locale;
    spaceId: string;
  }>;
};

export default async function SpaceWorkflowPage({
  params,
}: SpaceWorkflowPageProps) {
  const { locale, spaceId } = await params;
  setRequestLocale(locale);

  return <WorkflowWorkspace spaceId={spaceId} />;
}
