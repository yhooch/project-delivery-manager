import { setRequestLocale } from "next-intl/server";

import { BugsPage } from "../../../../components/bug/bugs-page";
import type { Locale } from "../../../../i18n/locales";

type BugsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function BugsRoutePage({ params }: BugsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <BugsPage />;
}
