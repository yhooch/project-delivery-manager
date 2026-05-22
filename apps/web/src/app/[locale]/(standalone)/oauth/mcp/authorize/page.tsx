import { setRequestLocale } from "next-intl/server";

import { McpAuthorizePage } from "../../../../../../components/oauth/mcp-authorize-page";
import type { Locale } from "../../../../../../i18n/locales";

type McpAuthorizeRouteProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function McpAuthorizeRoute({
  params,
}: McpAuthorizeRouteProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <McpAuthorizePage />;
}
