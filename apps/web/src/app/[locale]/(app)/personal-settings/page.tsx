import { setRequestLocale } from "next-intl/server";

import { PersonalSettingsPage } from "../../../../components/settings/personal-settings-page";
import type { Locale } from "../../../../i18n/locales";

type PersonalSettingsRouteProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function PersonalSettingsRoute({
  params,
}: PersonalSettingsRouteProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <PersonalSettingsPage />;
}
