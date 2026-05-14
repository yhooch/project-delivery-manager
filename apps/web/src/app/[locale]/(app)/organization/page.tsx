import { setRequestLocale } from "next-intl/server";

import { OrganizationPage } from "../../../../components/organization/organization-page";
import type { Locale } from "../../../../i18n/locales";

type OrganizationRoutePageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function OrganizationRoutePage({
  params,
}: OrganizationRoutePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <OrganizationPage />;
}
