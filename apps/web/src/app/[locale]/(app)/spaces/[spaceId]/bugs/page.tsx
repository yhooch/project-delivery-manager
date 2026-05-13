import { setRequestLocale } from "next-intl/server";

import { BugWorkspace } from "../../../../../../components/bug/bug-workspace";
import type { Locale } from "../../../../../../i18n/locales";

type SpaceBugsPageProps = {
  params: Promise<{
    locale: Locale;
    spaceId: string;
  }>;
  searchParams: Promise<{
    assigneeId?: string;
    bugId?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    relatedTaskId?: string;
    requirementId?: string;
    severity?: "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "TRIVIAL";
    statusCategory?:
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "WAITING"
      | "VERIFYING"
      | "DONE"
      | "TERMINATED";
    versionId?: string;
  }>;
};

export default async function SpaceBugsPage({
  params,
  searchParams,
}: SpaceBugsPageProps) {
  const { locale, spaceId } = await params;
  const {
    assigneeId,
    bugId,
    priority,
    relatedTaskId,
    requirementId,
    severity,
    statusCategory,
    versionId,
  } = await searchParams;
  setRequestLocale(locale);

  return (
    <BugWorkspace
      initialAssigneeId={assigneeId}
      initialBugId={bugId}
      initialPriority={priority}
      initialRelatedTaskId={relatedTaskId}
      initialRequirementId={requirementId}
      initialSeverity={severity}
      initialStatusCategory={statusCategory}
      initialVersionId={versionId}
      spaceId={spaceId}
    />
  );
}
