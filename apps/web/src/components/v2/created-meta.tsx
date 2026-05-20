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
  const displayDate = createdAt ? formatDate(createdAt, locale) : "";
  const tooltipDate = createdAt ? formatDateTime(createdAt, locale) : "";

  if (!creatorName && !createdAt) {
    return null;
  }

  const label = displayDate
    ? t("createdByAt", { date: displayDate, name: displayName })
    : t("createdBy", { name: displayName });
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

function formatDate(value: string, locale: string) {
  return formatDateValue(value, locale, { dateStyle: "medium" });
}

function formatDateTime(value: string, locale: string) {
  return formatDateValue(value, locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateValue(
  value: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, options).format(date);
}
