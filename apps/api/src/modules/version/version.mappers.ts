import type {
  StatusCategory,
  Version,
  VersionStatus,
  ViewExceptionSignal,
  ViewWorkItemSummary,
} from "@project-delivery/shared";

import type { VersionBoardWorkItemRecord } from "./version.types";

type PrismaVersionRecord = {
  blockedCount: number;
  bugCount: number;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  ownerId: string | null;
  releaseDate: Date | null;
  requirementCount: number;
  spaceId: string;
  startDate: Date | null;
  status: VersionStatus;
  target: string | null;
  targetDate: Date | null;
  taskCount: number;
};

export function toVersion(
  record: PrismaVersionRecord,
  overrides?: { requirementCount?: number },
): Version {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    name: record.name,
    target: record.target ?? undefined,
    description: record.description ?? undefined,
    ownerId: record.ownerId ?? undefined,
    status: record.status,
    startDate: record.startDate?.toISOString(),
    targetDate: record.targetDate?.toISOString(),
    releaseDate: record.releaseDate?.toISOString(),
    stats: {
      requirementCount:
        overrides?.requirementCount ?? record.requirementCount,
      taskCount: record.taskCount,
      bugCount: record.bugCount,
      blockedCount: record.blockedCount,
    },
  };
}

export function toVersionBoardWorkItemSummary(
  record: VersionBoardWorkItemRecord,
  input: {
    now: Date;
    staleThresholdDays: number;
  },
): ViewWorkItemSummary {
  const exceptionSignals = buildExceptionSignals(record, input);
  const pendingConfirm = isPendingConfirmState(record);
  const pendingRegression = isPendingRegressionState(record);

  return removeUndefined({
    assigneeId: record.assigneeId ?? undefined,
    currentStatus: {
      currentStateId: record.currentStateId,
      exceptionHints: {
        blocked: isBlocked(record),
        pendingConfirm,
        pendingRegression,
      },
      lastStatusChangedAt: record.lastStatusChangedAt.toISOString(),
      stateCode: record.currentState.code,
      stateName: record.currentState.name,
      statusCategory: record.statusCategory,
      workflowVersionId: record.workflowVersionId,
    },
    dueDate: record.dueDate?.toISOString(),
    exceptionSignals,
    id: record.id,
    intakeItemId: record.intakeItemId ?? undefined,
    lastActionAt: record.lastActionAt?.toISOString(),
    organizationId: record.organizationId,
    priority: record.priority,
    reporterId: record.reporterId,
    requirementId: record.requirementId ?? undefined,
    spaceId: record.spaceId,
    title: record.title,
    type: record.type,
    versionId: record.versionId ?? undefined,
  });
}

function buildExceptionSignals(
  record: VersionBoardWorkItemRecord,
  input: {
    now: Date;
    staleThresholdDays: number;
  },
): ViewExceptionSignal[] {
  const signals: ViewExceptionSignal[] = [];

  if (isBlocked(record)) {
    signals.push(
      removeUndefined({
        blockedAt: record.blockedAt?.toISOString(),
        blockedReason: record.blockedReason ?? undefined,
        evidenceSource: "BLOCKED_FIELD",
        reason: "Work item is marked as blocked.",
        type: "blocked",
      }),
    );
  }

  if (isOverdue(record, input.now)) {
    signals.push({
      dueDate: record.dueDate?.toISOString(),
      evidenceSource: "DUE_DATE",
      reason: "Due date has passed while the work item is still open.",
      type: "overdue",
    });
  }

  if (isPendingConfirmState(record)) {
    signals.push({
      currentStateId: record.currentStateId,
      evidenceSource: "WORKFLOW_STATE",
      reason: "Workflow state is waiting for confirmation.",
      type: "pending_confirm",
    });
  }

  if (isPendingRegressionState(record)) {
    signals.push({
      currentStateId: record.currentStateId,
      evidenceSource: "WORKFLOW_STATE",
      reason: "Bug is waiting for regression verification.",
      type: "pending_regression",
    });
  }

  const staleDays = getStaleDays(record, input.now);

  if (staleDays >= input.staleThresholdDays && !isTerminal(record.statusCategory)) {
    signals.push({
      evidenceSource: "LAST_STATUS_CHANGED_AT",
      lastStatusChangedAt: record.lastStatusChangedAt.toISOString(),
      reason: "Status has not changed within the configured stale threshold.",
      staleDays,
      staleThresholdDays: input.staleThresholdDays,
      type: "stale",
    });
  }

  return signals;
}

function isBlocked(record: VersionBoardWorkItemRecord) {
  return Boolean(record.blockedAt || record.blockedReason);
}

function isOverdue(record: VersionBoardWorkItemRecord, now: Date) {
  return Boolean(
    record.dueDate &&
      record.dueDate.getTime() < now.getTime() &&
      !isTerminal(record.statusCategory),
  );
}

function isPendingConfirmState(record: VersionBoardWorkItemRecord) {
  return (
    record.statusCategory === "WAITING" ||
    includesToken(record.currentState.code, "confirm") ||
    includesToken(record.currentState.name, "confirm")
  );
}

function isPendingRegressionState(record: VersionBoardWorkItemRecord) {
  return (
    record.type === "BUG" &&
    !record.bugDetail?.regressionAt &&
    (record.statusCategory === "VERIFYING" ||
      includesToken(record.currentState.code, "regression") ||
      includesToken(record.currentState.name, "regression"))
  );
}

function getStaleDays(record: VersionBoardWorkItemRecord, now: Date) {
  const diffMs = now.getTime() - record.lastStatusChangedAt.getTime();

  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

function isTerminal(statusCategory: StatusCategory) {
  return statusCategory === "DONE" || statusCategory === "TERMINATED";
}

function includesToken(value: string, token: string) {
  return value.toLowerCase().includes(token);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
