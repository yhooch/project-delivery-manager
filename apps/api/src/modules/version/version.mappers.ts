import type {
  Version,
  VersionStatus,
  ViewWorkItemSummary,
} from "@project-delivery/shared";

import {
  buildSpaceExceptionSignals,
  isBlockedRecord,
  isPendingConfirmRecord,
  isPendingRegressionRecord,
} from "../space/space-exception.helpers";
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

type VersionStatsOverrides = {
  blockedCount?: number;
  bugCount?: number;
  requirementCount?: number;
  taskCount?: number;
};

export function toVersion(
  record: PrismaVersionRecord,
  overrides?: VersionStatsOverrides,
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
    // Persisted counters remain in the schema for migration compatibility; live
    // repository overrides are the factual source for API stats.
    stats: {
      requirementCount: overrides?.requirementCount ?? record.requirementCount,
      taskCount: overrides?.taskCount ?? record.taskCount,
      bugCount: overrides?.bugCount ?? record.bugCount,
      blockedCount: overrides?.blockedCount ?? record.blockedCount,
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
  const exceptionSignals = buildSpaceExceptionSignals(record, input);
  const pendingConfirm = isPendingConfirmRecord(record);
  const pendingRegression = isPendingRegressionRecord(record);

  return removeUndefined({
    assigneeId: record.assigneeId ?? undefined,
    currentStatus: {
      currentStateId: record.currentStateId,
      exceptionHints: {
        blocked: isBlockedRecord(record),
        pendingConfirm,
        pendingRegression,
      },
      lastStatusChangedAt: record.lastStatusChangedAt.toISOString(),
      stateCode: record.currentState.code,
      stateName: record.currentState.name,
      statusCategory: record.statusCategory,
      workflowVersionId: record.workflowVersionId,
    },
    createdAt: record.createdAt.toISOString(),
    createdById: record.createdById ?? undefined,
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

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
