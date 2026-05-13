import { setRequestLocale } from "next-intl/server";

import { AuthShell } from "../../../../components/auth/auth-shell";
import { LoginForm } from "../../../../components/auth/login-form";
import type { Locale } from "../../../../i18n/locales";

type LoginPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function LoginPage({ params }: LoginPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <AuthShell mode="login">
      <LoginForm />
    </AuthShell>
  );
}
