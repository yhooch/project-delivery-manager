import { setRequestLocale } from "next-intl/server";

import { SpaceExceptionsWorkspace } from "../../../../../../components/exception/space-exceptions-workspace";
import type { Locale } from "../../../../../../i18n/locales";

type SpaceExceptionsPageProps = {
  params: Promise<{
    locale: Locale;
    spaceId: string;
  }>;
  searchParams: Promise<{
    assigneeId?: string;
    exceptionType?:
      | "overdue"
      | "blocked"
      | "pending_confirm"
      | "pending_regression"
      | "stale";
    statusCategory?:
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "WAITING"
      | "VERIFYING"
      | "DONE"
      | "TERMINATED";
    workItemType?: "TASK" | "BUG";
  }>;
};

export default async function SpaceExceptionsPage({
  params,
  searchParams,
}: SpaceExceptionsPageProps) {
  const { locale, spaceId } = await params;
  const { assigneeId, exceptionType, statusCategory, workItemType } =
    await searchParams;
  setRequestLocale(locale);

  return (
    <SpaceExceptionsWorkspace
      initialAssigneeId={assigneeId}
      initialExceptionType={exceptionType}
      initialStatusCategory={statusCategory}
      initialWorkItemType={workItemType}
      spaceId={spaceId}
    />
  );
}
