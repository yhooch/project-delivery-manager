"use client";

import {
  ArrowUpRight,
  CircleDot,
  Clock3,
  ListChecks,
  LogIn,
  Signal,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";
import { OrganizationOnboarding } from "../onboarding/organization-onboarding";

const metricItems = [
  {
    icon: ListChecks,
    key: "requirements",
  },
  {
    icon: Clock3,
    key: "sla",
  },
  {
    icon: CircleDot,
    key: "activeWork",
  },
  {
    icon: Signal,
    key: "deliverySignal",
  },
] as const;

const queueRows = ["triage", "handoff", "review", "blocked"] as const;
const activityRows = ["intake", "workflow", "comment"] as const;
const signalRows = ["scope", "risk", "quality"] as const;

export function DashboardWorkspace() {
  const t = useTranslations("dashboard");
  const { currentOrganization, session, status } = useSession();

  if (status === "loading") {
    return (
      <section className="state-panel" aria-live="polite">
        <div className="state-panel__icon">
          <Signal aria-hidden="true" size={18} strokeWidth={2} />
        </div>
        <h2>{t("session.loading.title")}</h2>
        <p>{t("session.loading.description")}</p>
      </section>
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <section className="state-panel">
        <div className="state-panel__icon">
          <LogIn aria-hidden="true" size={18} strokeWidth={2} />
        </div>
        <h2>{t("session.unauthenticated.title")}</h2>
        <p>{t("session.unauthenticated.description")}</p>
        <div className="state-panel__actions">
          <Link className="button button--primary" href="/login">
            {t("session.unauthenticated.login")}
          </Link>
          <Link className="button button--secondary" href="/register">
            {t("session.unauthenticated.register")}
          </Link>
        </div>
      </section>
    );
  }

  if (session.organizations.length === 0) {
    return <OrganizationOnboarding session={session} />;
  }

  return (
    <div className="dashboard">
      <section className="page-heading" aria-labelledby="dashboard-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="dashboard-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>
            {currentOrganization
              ? t("page.scopeWithOrganization", {
                  organization: currentOrganization.name,
                })
              : t("page.scope")}
          </span>
          <span>{t("page.refresh")}</span>
        </div>
      </section>

      <section className="metric-grid" aria-label={t("metrics.label")}>
        {metricItems.map((item) => {
          const Icon = item.icon;

          return (
            <article className="metric-card" key={item.key}>
              <div className="metric-card__header">
                <span className="metric-card__label">
                  {t(`metrics.${item.key}.label`)}
                </span>
                <Icon aria-hidden="true" size={16} strokeWidth={2} />
              </div>
              <div className="metric-card__value">
                {t(`metrics.${item.key}.value`)}
              </div>
              <div className="metric-card__delta">
                <ArrowUpRight aria-hidden="true" size={14} strokeWidth={2} />
                <span>{t(`metrics.${item.key}.delta`)}</span>
              </div>
            </article>
          );
        })}
      </section>

      <div className="dashboard-grid">
        <section className="panel panel--wide" aria-labelledby="queue-title">
          <div className="panel__header">
            <div>
              <h3 id="queue-title">{t("queue.title")}</h3>
              <p>{t("queue.subtitle")}</p>
            </div>
            <span className="panel__badge">{t("queue.badge")}</span>
          </div>
          <div className="data-table" role="table" aria-label={t("queue.title")}>
            <div className="data-table__row data-table__row--head" role="row">
              <span role="columnheader">{t("queue.columns.item")}</span>
              <span role="columnheader">{t("queue.columns.owner")}</span>
              <span role="columnheader">{t("queue.columns.state")}</span>
              <span role="columnheader">{t("queue.columns.due")}</span>
            </div>
            {queueRows.map((row) => (
              <div className="data-table__row" key={row} role="row">
                <span role="cell">{t(`queue.rows.${row}.item`)}</span>
                <span role="cell">{t(`queue.rows.${row}.owner`)}</span>
                <span role="cell">
                  <span className="status-pill">
                    {t(`queue.rows.${row}.state`)}
                  </span>
                </span>
                <span role="cell">{t(`queue.rows.${row}.due`)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="activity-title">
          <div className="panel__header">
            <div>
              <h3 id="activity-title">{t("activity.title")}</h3>
              <p>{t("activity.subtitle")}</p>
            </div>
          </div>
          <ol className="activity-list">
            {activityRows.map((row) => (
              <li className="activity-list__item" key={row}>
                <span className="activity-list__dot" aria-hidden="true" />
                <div>
                  <span>{t(`activity.rows.${row}.title`)}</span>
                  <small>{t(`activity.rows.${row}.meta`)}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel panel--wide" aria-labelledby="signals-title">
          <div className="panel__header">
            <div>
              <h3 id="signals-title">{t("signals.title")}</h3>
              <p>{t("signals.subtitle")}</p>
            </div>
            <span className="panel__badge panel__badge--neutral">
              {t("signals.badge")}
            </span>
          </div>
          <div className="signal-grid">
            {signalRows.map((row) => (
              <div className="signal-row" key={row}>
                <div>
                  <span>{t(`signals.rows.${row}.label`)}</span>
                  <small>{t(`signals.rows.${row}.description`)}</small>
                </div>
                <strong>{t(`signals.rows.${row}.value`)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
