import { setRequestLocale } from "next-intl/server";

import { BugLanding } from "../../../../components/bug/bug-landing";
import type { Locale } from "../../../../i18n/locales";

type BugsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function BugsPage({ params }: BugsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <BugLanding />;
}
