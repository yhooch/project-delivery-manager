import { setRequestLocale } from "next-intl/server";

import { RequirementListWorkspace } from "../../../../../../components/requirement/requirement-list-workspace";
import type { Locale } from "../../../../../../i18n/locales";

type SpaceRequirementsPageProps = {
  params: Promise<{
    locale: Locale;
    spaceId: string;
  }>;
  searchParams: Promise<{
    versionId?: string;
  }>;
};

export default async function SpaceRequirementsPage({
  params,
  searchParams,
}: SpaceRequirementsPageProps) {
  const { locale, spaceId } = await params;
  const { versionId } = await searchParams;
  setRequestLocale(locale);

  return (
    <RequirementListWorkspace
      initialVersionId={versionId}
      spaceId={spaceId}
    />
  );
}
