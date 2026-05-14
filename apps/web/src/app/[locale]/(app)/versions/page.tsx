import { setRequestLocale } from "next-intl/server";

import { VersionBoard } from "../../../../components/version-board/version-board";
import type { Locale } from "../../../../i18n/locales";

type VersionsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function VersionsPage({ params }: VersionsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <VersionBoard />;
}
