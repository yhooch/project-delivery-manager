import { setRequestLocale } from "next-intl/server";

import { SpaceOverviewWorkspace } from "../../../../../components/space/space-overview-workspace";
import type { Locale } from "../../../../../i18n/locales";

type SpaceOverviewPageProps = {
  params: Promise<{
    locale: Locale;
    spaceId: string;
  }>;
  searchParams: Promise<{
    versionId?: string;
  }>;
};

export default async function SpaceOverviewPage({
  params,
  searchParams,
}: SpaceOverviewPageProps) {
  const { locale, spaceId } = await params;
  const { versionId } = await searchParams;
  setRequestLocale(locale);

  return <SpaceOverviewWorkspace initialVersionId={versionId} spaceId={spaceId} />;
}
