import { setRequestLocale } from "next-intl/server";

import { IntakeWorkspace } from "../../../../../../components/intake/intake-workspace";
import type { Locale } from "../../../../../../i18n/locales";

type SpaceIntakeItemsPageProps = {
  params: Promise<{
    locale: Locale;
    spaceId: string;
  }>;
  searchParams: Promise<{
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    requirementId?: string;
    status?: "PENDING" | "ACCEPTED" | "DEFERRED" | "REJECTED" | "CONVERTED";
    versionId?: string;
  }>;
};

export default async function SpaceIntakeItemsPage({
  params,
  searchParams,
}: SpaceIntakeItemsPageProps) {
  const { locale, spaceId } = await params;
  const { priority, requirementId, status, versionId } = await searchParams;
  setRequestLocale(locale);

  return (
    <IntakeWorkspace
      initialPriority={priority}
      initialRequirementId={requirementId}
      initialStatus={status}
      initialVersionId={versionId}
      spaceId={spaceId}
    />
  );
}
