import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DocumentShell } from "../../../components/document/document-shell";
import { isLocale } from "../../../i18n/locales";

type DocumentsLayoutProps = {
  children: ReactNode;
  params: Promise<{
    locale: string;
  }>;
};

export default async function DocumentsLayout({
  children,
  params,
}: DocumentsLayoutProps) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return <DocumentShell>{children}</DocumentShell>;
}
