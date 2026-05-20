"use client";

import { useLocale, useTranslations } from "next-intl";

import { cn } from "../../lib/utils";
import { Tip } from "../ui/tooltip";

type CreatedMetaProps = {
  className?: string;
  createdAt?: string;
  creatorName?: string;
};

export function CreatedMeta({
  className,
  createdAt,
  creatorName,
}: CreatedMetaProps) {
  const locale = useLocale();
  const t = useTranslations("common.objectMeta");
  const displayName = creatorName?.trim() || t("unknownCreator");
  const displayDate = createdAt
    ? formatListDate(createdAt, locale, (key, values) => t(key, values))
    : "";
  const tooltipDate = createdAt ? formatDateTime(createdAt, locale) : "";

  if (!creatorName && !createdAt) {
    return null;
  }

  const label = displayDate
    ? t("listLabelWithDate", { date: displayDate, name: displayName })
    : t("listLabel", { name: displayName });
  const tooltip = tooltipDate
    ? t("createdTooltip", { date: tooltipDate, name: displayName })
    : t("creatorTooltip", { name: displayName });

  return (
    <Tip content={tooltip}>
      <span
        className={cn(
          "block min-w-0 max-w-full truncate text-[11px] leading-4 text-muted-foreground",
          className,
        )}
      >
        {label}
      </span>
    </Tip>
  );
}

type RelativeDateTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function formatListDate(
  value: string,
  locale: string,
  t: RelativeDateTranslator,
  now = new Date(),
) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = now.getTime() - date.getTime();
  if (diffMs >= 0 && diffMs < 60_000) {
    return t("justNow");
  }

  if (diffMs >= 60_000 && diffMs < 60 * 60_000) {
    return t("minutesAgo", { count: Math.floor(diffMs / 60_000) });
  }

  const time = formatDateValue(date, locale, {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });

  if (isSameLocalDate(date, now)) {
    return t("todayAt", { time });
  }

  if (isYesterday(date, now)) {
    return t("yesterdayAt", { time });
  }

  if (date.getFullYear() === now.getFullYear()) {
    return formatDateValue(date, locale, {
      day: "numeric",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "long",
    });
  }

  return formatDateValue(date, locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(value: string, locale: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatDateValue(date, locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateValue(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function isYesterday(date: Date, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return isSameLocalDate(date, yesterday);
}

function isSameLocalDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
