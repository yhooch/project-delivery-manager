import { setRequestLocale } from "next-intl/server";

import { RequirementDetailWorkspace } from "../../../../../components/requirement/requirement-detail-workspace";
import { RequirementNotionShell } from "../../../../../components/requirement/requirement-notion-shell";
import type { Locale } from "../../../../../i18n/locales";

type RequirementDetailPageProps = {
  params: Promise<{
    locale: Locale;
    requirementId: string;
  }>;
};

export default async function RequirementDetailPage({
  params,
}: RequirementDetailPageProps) {
  const { locale, requirementId } = await params;
  setRequestLocale(locale);

  return (
    <RequirementNotionShell>
      <RequirementDetailWorkspace requirementId={requirementId} />
    </RequirementNotionShell>
  );
}
