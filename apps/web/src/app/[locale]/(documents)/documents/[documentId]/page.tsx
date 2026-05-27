import { setRequestLocale } from "next-intl/server";

import { DocumentDetailPage } from "../../../../../components/document/document-detail-page";
import type { Locale } from "../../../../../i18n/locales";

type DocumentDetailRoutePageProps = {
  params: Promise<{
    documentId: string;
    locale: Locale;
  }>;
};

export default async function DocumentDetailRoutePage({
  params,
}: DocumentDetailRoutePageProps) {
  const { documentId, locale } = await params;
  setRequestLocale(locale);

  return <DocumentDetailPage documentId={documentId} />;
}
