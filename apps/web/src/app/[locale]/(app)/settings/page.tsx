import { setRequestLocale } from "next-intl/server";

import { SpaceSettingsPage } from "../../../../components/space/settings-page";
import type { Locale } from "../../../../i18n/locales";

type SettingsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <SpaceSettingsPage />;
}
