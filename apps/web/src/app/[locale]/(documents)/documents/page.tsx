import { setRequestLocale } from "next-intl/server";

import { DocumentsPage } from "../../../../components/document/documents-page";
import type { Locale } from "../../../../i18n/locales";

type DocumentsPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function DocumentsRoutePage({
  params,
}: DocumentsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <DocumentsPage />;
}
