import { setRequestLocale } from "next-intl/server";

import { AuthShell } from "../../../../components/auth/auth-shell";
import { RegisterForm } from "../../../../components/auth/register-form";
import type { Locale } from "../../../../i18n/locales";

type RegisterPageProps = {
  params: Promise<{
    locale: Locale;
  }>;
};

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <AuthShell mode="register">
      <RegisterForm />
    </AuthShell>
  );
}
