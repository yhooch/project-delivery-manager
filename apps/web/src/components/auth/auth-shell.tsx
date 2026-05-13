import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Link } from "../../i18n/routing";
import { LanguageSwitch } from "../shell/language-switch";
import { ThemeSwitch } from "../shell/theme-switch";

type AuthMode = "login" | "register";

type AuthShellProps = {
  children: ReactNode;
  mode: AuthMode;
};

export function AuthShell({ children, mode }: AuthShellProps) {
  const t = useTranslations("auth");
  const alternateMode = mode === "login" ? "register" : "login";
  const alternateHref = mode === "login" ? "/register" : "/login";

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <Link className="brand-lockup brand-lockup--auth" href="/">
          <div className="brand-lockup__mark" aria-hidden="true">
            {t("brand.shortName")}
          </div>
          <div className="brand-lockup__text">
            <span className="brand-lockup__name">{t("brand.name")}</span>
            <span className="brand-lockup__meta">{t("brand.subtitle")}</span>
          </div>
        </Link>
        <div className="auth-topbar__tools">
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </header>

      <section className="auth-layout" aria-labelledby="auth-title">
        <div className="auth-copy">
          <p className="page-heading__eyebrow">{t(`${mode}.eyebrow`)}</p>
          <h1 id="auth-title">{t(`${mode}.title`)}</h1>
          <p>{t(`${mode}.description`)}</p>
          <dl className="auth-facts">
            <div>
              <dt>{t("facts.contract.dt")}</dt>
              <dd>{t("facts.contract.dd")}</dd>
            </div>
            <div>
              <dt>{t("facts.session.dt")}</dt>
              <dd>{t("facts.session.dd")}</dd>
            </div>
            <div>
              <dt>{t("facts.preference.dt")}</dt>
              <dd>{t("facts.preference.dd")}</dd>
            </div>
          </dl>
        </div>
        <div className="auth-card">
          {children}
          <div className="auth-card__footer">
            <span>{t(`${mode}.alternatePrompt`)}</span>
            <Link href={alternateHref}>{t(`${alternateMode}.link`)}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
