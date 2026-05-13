import { setRequestLocale } from "next-intl/server";

import { VersionWorkspace } from "../../../../../../components/version/version-workspace";
import type { Locale } from "../../../../../../i18n/locales";

type SpaceVersionsPageProps = {
  params: Promise<{
    locale: Locale;
    spaceId: string;
  }>;
};

export default async function SpaceVersionsPage({
  params,
}: SpaceVersionsPageProps) {
  const { locale, spaceId } = await params;
  setRequestLocale(locale);

  return <VersionWorkspace spaceId={spaceId} />;
}
