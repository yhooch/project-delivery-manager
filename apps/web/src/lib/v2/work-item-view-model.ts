import type {
  SpaceMemberWithUser,
  StatusCategory,
  TagDto,
  Version,
  ViewWorkItemSummary,
  WorkItem,
} from "@project-delivery/shared";

import { resolveWorkItemDisplayCode } from "../display-code";

export type WorkItemViewModel = {
  id: string;
  listKey?: string;
  code: string;
  type: "TASK" | "BUG";
  organizationId?: string;
  spaceId?: string;
  title: string;
  contextLabel?: string;
  workflowVersionId: string;
  currentStateId: string;
  statusCategory: StatusCategory;
  statusLabel: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assignee: { name: string; initial: string };
  creatorName?: string;
  createdAt?: string;
  versionName?: string;
  dueDate?: string;
  isOverdue?: boolean;
  isBlocked?: boolean;
  blockedReason?: string;
  updatedAgo?: string;
  tags?: readonly TagDto[];
};

export type WorkItemViewModelLookupHelpers = {
  getMember: (
    userId: string,
    spaceId?: string,
  ) => SpaceMemberWithUser | undefined;
  getVersion: (versionId: string, spaceId?: string) => Version | undefined;
  getWorkflowState?: (
    workflowVersionId: string | undefined,
    stateId: string | undefined,
    spaceId?: string,
  ) => { code?: string; name: string } | undefined;
};

type WorkItemViewModelOptions = {
  locale: string;
  lookups?: WorkItemViewModelLookupHelpers;
  statusLabel?: (category: StatusCategory) => string;
  workflowStateLabel?: (state: { code?: string; name: string }) => string;
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
    workflowStateLabel,
    justNowLabel,
    unknownVersionLabel,
  }: WorkItemViewModelOptions,
): WorkItemViewModel {
  const code = resolveWorkItemDisplayCode(item);
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
  const creatorId = item.createdById ?? item.reporterId;
  const creatorName = resolveMemberName(creatorId, item.spaceId, lookups);
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
    organizationId: item.organizationId,
    spaceId: item.spaceId,
    title: item.title,
    workflowVersionId: item.currentStatus.workflowVersionId,
    currentStateId: item.currentStatus.currentStateId,
    statusCategory: item.currentStatus.statusCategory,
    statusLabel:
      workflowStateLabel?.({
        code: item.currentStatus.stateCode,
        name: item.currentStatus.stateName,
      }) ?? item.currentStatus.stateName,
    priority: item.priority,
    assignee: {
      name: assigneeName,
      initial: initialOf(assigneeName),
    },
    creatorName,
    createdAt: item.createdAt,
    versionName,
    dueDate,
    isOverdue,
    isBlocked: Boolean(blockedSignal),
    blockedReason: blockedSignal?.reason,
    updatedAgo,
    tags: "tags" in item && Array.isArray(item.tags) ? item.tags : [],
  };
}

export function toWorkItemListViewModel(
  item: WorkItem,
  {
    locale,
    lookups,
    statusLabel,
    workflowStateLabel,
    unknownVersionLabel,
  }: WorkItemViewModelOptions,
): WorkItemViewModel {
  const code = resolveWorkItemDisplayCode(item);
  const member = item.assigneeId
    ? lookups?.getMember(item.assigneeId, item.spaceId)
    : undefined;
  const assigneeName = member?.user.name ?? member?.user.username ?? "";
  const creatorId = item.createdById ?? item.reporterId;
  const creatorName = resolveMemberName(creatorId, item.spaceId, lookups);
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
  const isBlocked = Boolean(item.blockedAt);
  const workflowState = lookups?.getWorkflowState?.(
    item.workflowVersionId,
    item.currentStateId,
    item.spaceId,
  );

  return {
    id: item.id,
    code,
    type: item.type,
    organizationId: item.organizationId,
    spaceId: item.spaceId,
    title: item.title,
    workflowVersionId: item.workflowVersionId,
    currentStateId: item.currentStateId,
    statusCategory: item.statusCategory,
    statusLabel: workflowState
      ? (workflowStateLabel?.(workflowState) ?? workflowState.name)
      : (statusLabel?.(item.statusCategory) ?? item.statusCategory),
    priority: item.priority,
    assignee: {
      name: assigneeName,
      initial: initialOf(assigneeName),
    },
    creatorName,
    createdAt: item.createdAt,
    versionName,
    dueDate,
    isOverdue,
    isBlocked,
    blockedReason: item.blockedReason,
    updatedAgo: undefined,
    tags: item.tags,
  };
}

function resolveMemberName(
  userId: string | undefined,
  spaceId: string | undefined,
  lookups: WorkItemViewModelLookupHelpers | undefined,
) {
  if (!userId) {
    return undefined;
  }

  const member = lookups?.getMember(userId, spaceId);

  return member?.user.name ?? member?.user.username ?? userId;
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
