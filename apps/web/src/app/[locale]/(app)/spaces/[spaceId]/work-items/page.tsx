import { setRequestLocale } from "next-intl/server";

import { WorkItemWorkspace } from "../../../../../../components/work-item/work-item-workspace";
import type { Locale } from "../../../../../../i18n/locales";

type SpaceWorkItemsPageProps = {
  params: Promise<{
    locale: Locale;
    spaceId: string;
  }>;
  searchParams: Promise<{
    assigneeId?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    requirementId?: string;
    statusCategory?:
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "WAITING"
      | "VERIFYING"
      | "DONE"
      | "TERMINATED";
    versionId?: string;
    workItemId?: string;
  }>;
};

export default async function SpaceWorkItemsPage({
  params,
  searchParams,
}: SpaceWorkItemsPageProps) {
  const { locale, spaceId } = await params;
  const {
    assigneeId,
    priority,
    requirementId,
    statusCategory,
    versionId,
    workItemId,
  } = await searchParams;
  setRequestLocale(locale);

  return (
    <WorkItemWorkspace
      initialAssigneeId={assigneeId}
      initialPriority={priority}
      initialRequirementId={requirementId}
      initialStatusCategory={statusCategory}
      initialVersionId={versionId}
      initialWorkItemId={workItemId}
      spaceId={spaceId}
    />
  );
}
