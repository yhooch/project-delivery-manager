import { setRequestLocale } from "next-intl/server";

import { SpacesPage } from "../../../../components/space/spaces-page";
import type { Locale } from "../../../../i18n/locales";

type SpacesRoutePageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function SpacesRoutePage({
  params,
}: SpacesRoutePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <SpacesPage />;
}
