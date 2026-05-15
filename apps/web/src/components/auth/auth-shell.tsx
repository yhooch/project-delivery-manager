"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Link } from "../../i18n/routing";
import { LanguageToggle } from "../shell/language-toggle";
import { ThemeToggle } from "../shell/theme-toggle";

type AuthMode = "login" | "register";

type AuthShellProps = {
  children: ReactNode;
  mode: AuthMode;
};

export function AuthShell({ children, mode }: AuthShellProps) {
  const t = useTranslations("auth");
  const tBrand = useTranslations("shell.brand");
  const alternateHref = mode === "login" ? "/register" : "/login";

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[12px] font-bold text-primary-foreground">
            {tBrand("shortName")}
          </div>
          <span className="text-sm font-semibold tracking-tight">
            {t("brand.name")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>

      <footer className="px-5 py-4 text-center text-[11px] text-muted-foreground">
        <span>{t(`${mode}.alternatePrompt`)} </span>
        <Link
          href={alternateHref}
          className="font-medium text-primary hover:underline"
        >
          {t(`${mode}.link`)}
        </Link>
      </footer>
    </div>
  );
}
