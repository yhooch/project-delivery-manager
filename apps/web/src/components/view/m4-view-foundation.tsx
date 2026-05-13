"use client";

import type {
  StatusCategory,
  ViewExceptionType,
  ViewWorkItemSummary,
} from "@project-delivery/shared";
import { AlertTriangle, ClipboardList, Inbox } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";

export type StatusCategoryColumnProps = {
  children?: ReactNode;
  statusCategory: StatusCategory;
  total: number;
};

export type ExceptionTypeTagProps = {
  type: ViewExceptionType;
};

export type WorkItemSummaryCardProps = {
  assigneeName?: string;
  item: ViewWorkItemSummary;
  reporterName?: string;
  trailing?: ReactNode;
  versionName?: string;
};

export type ViewEmptyStateProps = {
  compact?: boolean;
  descriptionKey?: string;
  titleKey: string;
};

export function StatusCategoryColumn({
  children,
  statusCategory,
  total,
}: StatusCategoryColumnProps) {
  const t = useTranslations();
  const titleId = useId();

  return (
    <section className="m4-status-column" aria-labelledby={titleId}>
      <header className="m4-status-column__header">
        <div>
          <p className="m4-status-column__eyebrow">
            {t("m4Views.column.eyebrow")}
          </p>
          <h3 id={titleId}>{t(`m4Views.statusCategory.${statusCategory}`)}</h3>
        </div>
        <span className="m4-count-pill">
          {t("m4Views.column.total", { count: total })}
        </span>
      </header>
      <div className="m4-status-column__body">
        {children ?? (
          <ViewEmptyState
            compact
            descriptionKey="m4Views.empty.column.description"
            titleKey="m4Views.empty.column.title"
          />
        )}
      </div>
    </section>
  );
}

export function ExceptionTypeTag({ type }: ExceptionTypeTagProps) {
  const t = useTranslations();

  return (
    <span className="m4-exception-tag" data-exception-type={type}>
      <AlertTriangle aria-hidden="true" size={14} />
      <span>{t(`m4Views.exceptionType.${type}`)}</span>
    </span>
  );
}

export function WorkItemSummaryCard({
  assigneeName,
  item,
  reporterName,
  trailing,
  versionName,
}: WorkItemSummaryCardProps) {
  const t = useTranslations();
  const locale = useLocale();
  const dueDate = formatDate(item.dueDate, locale);

  return (
    <article className="m4-work-item-card">
      <div className="m4-work-item-card__main">
        <div className="m4-work-item-card__title-row">
          <span className="m4-work-item-card__type">
            {t(`m4Views.workItemType.${item.type}`)}
          </span>
          <h4>{item.title}</h4>
        </div>
        <dl className="m4-work-item-card__meta">
          <div>
            <dt>{t("m4Views.card.status")}</dt>
            <dd>
              <StatusPill statusCategory={item.currentStatus.statusCategory} />
              <span>{item.currentStatus.stateName}</span>
            </dd>
          </div>
          <div>
            <dt>{t("m4Views.card.priority")}</dt>
            <dd>{t(`m4Views.priority.${item.priority}`)}</dd>
          </div>
          <div>
            <dt>{t("m4Views.card.assignee")}</dt>
            <dd>{assigneeName ?? t("m4Views.card.unassigned")}</dd>
          </div>
          <div>
            <dt>{t("m4Views.card.reporter")}</dt>
            <dd>{reporterName ?? item.reporterId}</dd>
          </div>
          <div>
            <dt>{t("m4Views.card.version")}</dt>
            <dd>{versionName ?? item.versionId ?? t("m4Views.card.noVersion")}</dd>
          </div>
          <div>
            <dt>{t("m4Views.card.dueDate")}</dt>
            <dd>{dueDate ?? t("m4Views.card.noDueDate")}</dd>
          </div>
        </dl>
        {item.exceptionSignals.length > 0 ? (
          <div
            className="m4-work-item-card__exceptions"
            aria-label={t("m4Views.card.exceptions")}
          >
            {item.exceptionSignals.map((signal) => (
              <ExceptionTypeTag
                key={`${signal.type}:${signal.evidenceSource}:${signal.reason}`}
                type={signal.type}
              />
            ))}
          </div>
        ) : null}
      </div>
      {trailing ? <div className="m4-work-item-card__trailing">{trailing}</div> : null}
    </article>
  );
}

export function ViewEmptyState({
  compact = false,
  descriptionKey,
  titleKey,
}: ViewEmptyStateProps) {
  const t = useTranslations();
  const Icon = compact ? ClipboardList : Inbox;

  return (
    <div className="m4-empty-state" data-compact={compact}>
      <Icon aria-hidden="true" size={compact ? 18 : 24} />
      <div>
        <h3>{t(titleKey)}</h3>
        {descriptionKey ? <p>{t(descriptionKey)}</p> : null}
      </div>
    </div>
  );
}

function StatusPill({ statusCategory }: { statusCategory: StatusCategory }) {
  const t = useTranslations();

  return (
    <span className="m4-status-pill" data-status-category={statusCategory}>
      {t(`m4Views.statusCategory.${statusCategory}`)}
    </span>
  );
}

function formatDate(value: string | undefined, locale: string) {
  if (!value) {
    return undefined;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
