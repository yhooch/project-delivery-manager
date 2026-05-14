import { setRequestLocale } from "next-intl/server";

import { SpaceManagementWorkspace } from "../../../../components/space/space-management-workspace";
import type { Locale } from "../../../../i18n/locales";

type SettingsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <SpaceManagementWorkspace />;
}
