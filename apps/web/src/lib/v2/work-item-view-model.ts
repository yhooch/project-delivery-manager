import type {
  SpaceMemberWithUser,
  StatusCategory,
  Version,
  ViewWorkItemSummary,
  WorkItem,
} from "@project-delivery/shared";

import { formatDisplayCode } from "../display-code";

export type WorkItemViewModel = {
  id: string;
  listKey?: string;
  code: string;
  type: "TASK" | "BUG";
  title: string;
  contextLabel?: string;
  statusCategory: StatusCategory;
  statusLabel: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assignee: { name: string; initial: string };
  versionName?: string;
  dueDate?: string;
  isOverdue?: boolean;
  isBlocked?: boolean;
  blockedReason?: string;
  updatedAgo?: string;
};

export type WorkItemViewModelLookupHelpers = {
  getMember: (
    userId: string,
    spaceId?: string,
  ) => SpaceMemberWithUser | undefined;
  getVersion: (versionId: string, spaceId?: string) => Version | undefined;
};

type WorkItemViewModelOptions = {
  locale: string;
  lookups?: WorkItemViewModelLookupHelpers;
  statusLabel?: (category: StatusCategory) => string;
  justNowLabel?: string;
  unknownVersionLabel?: string;
};

export function createWorkItemViewModelMapper(
  options: WorkItemViewModelOptions,
) {
  return (item: ViewWorkItemSummary): WorkItemViewModel =>
    toWorkItemViewModel(item, options);
}

export function toWorkItemViewModel(
  item: ViewWorkItemSummary,
  {
    locale,
    lookups,
    statusLabel,
    justNowLabel,
    unknownVersionLabel,
  }: WorkItemViewModelOptions,
): WorkItemViewModel {
  const code = formatDisplayCode(item.type === "BUG" ? "BUG" : "TASK", item.id);
  const isOverdue = item.exceptionSignals.some(
    (signal) => signal.type === "overdue",
  );
  const blockedSignal = item.exceptionSignals.find(
    (signal) => signal.type === "blocked",
  );
  const dueDate = item.dueDate
    ? formatOptionalDate(item.dueDate, locale)
    : undefined;
  const updatedAgo = item.lastActionAt
    ? formatTimeAgo(item.lastActionAt, locale, justNowLabel)
    : undefined;

  const member = item.assigneeId
    ? lookups?.getMember(item.assigneeId, item.spaceId)
    : undefined;
  const assigneeName =
    member?.user.name ?? member?.user.username ?? item.assigneeId ?? "-";
  const version = item.versionId
    ? lookups?.getVersion(item.versionId, item.spaceId)
    : undefined;
  const versionName = item.versionId
    ? (version?.name ?? unknownVersionLabel)
    : undefined;

  return {
    id: item.id,
    code,
    type: item.type,
    title: item.title,
    statusCategory: item.currentStatus.statusCategory,
    statusLabel:
      statusLabel?.(item.currentStatus.statusCategory) ??
      item.currentStatus.stateName,
    priority: item.priority,
    assignee: {
      name: assigneeName,
      initial: initialOf(assigneeName),
    },
    versionName,
    dueDate,
    isOverdue,
    isBlocked: Boolean(blockedSignal),
    blockedReason: blockedSignal?.reason,
    updatedAgo,
  };
}

export function toWorkItemListViewModel(
  item: WorkItem,
  {
    locale,
    lookups,
    statusLabel,
    unknownVersionLabel,
  }: WorkItemViewModelOptions,
): WorkItemViewModel {
  const code = formatDisplayCode(item.type, item.id);
  const member = item.assigneeId
    ? lookups?.getMember(item.assigneeId, item.spaceId)
    : undefined;
  const assigneeName = member?.user.name ?? member?.user.username ?? "";
  const version = item.versionId
    ? lookups?.getVersion(item.versionId, item.spaceId)
    : undefined;
  const versionName = item.versionId
    ? (version?.name ?? unknownVersionLabel)
    : undefined;
  const dueDate = item.dueDate
    ? formatOptionalDate(item.dueDate, locale)
    : undefined;
  const isOverdue = item.dueDate
    ? new Date(item.dueDate).getTime() < Date.now() &&
      item.statusCategory !== "DONE" &&
      item.statusCategory !== "TERMINATED"
    : false;
  const isBlocked =
    item.statusCategory === "WAITING" || Boolean(item.blockedAt);

  return {
    id: item.id,
    code,
    type: item.type,
    title: item.title,
    statusCategory: item.statusCategory,
    statusLabel: statusLabel?.(item.statusCategory) ?? item.statusCategory,
    priority: item.priority,
    assignee: {
      name: assigneeName,
      initial: initialOf(assigneeName),
    },
    versionName,
    dueDate,
    isOverdue,
    isBlocked,
    blockedReason: item.blockedReason,
    updatedAgo: undefined,
  };
}

function initialOf(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "?";
  }

  return trimmed.slice(0, 1).toUpperCase();
}

function formatOptionalDate(value: string, locale: string): string | undefined {
  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date,
    );
  } catch {
    return undefined;
  }
}

function formatTimeAgo(value: string, locale: string, justNowLabel = "") {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (Math.abs(diffMin) < 1) {
    return justNowLabel;
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffMin) < 60) {
    return rtf.format(-diffMin, "minute");
  }

  const diffHour = Math.round(diffMin / 60);

  if (Math.abs(diffHour) < 24) {
    return rtf.format(-diffHour, "hour");
  }

  const diffDay = Math.round(diffHour / 24);

  return rtf.format(-diffDay, "day");
}
