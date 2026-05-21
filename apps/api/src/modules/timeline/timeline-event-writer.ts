import type {
  TargetType,
  TimelineEventMetadata,
  TimelineEventType,
  WorkItemType,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";

export type CreateTimelineEventRecordInput = {
  actorUserId: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  detail?: string;
  eventType: TimelineEventType;
  id?: string;
  metadata?: TimelineEventMetadata;
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: TargetType;
  targetWorkItemType?: WorkItemType;
  title: string;
};

export async function createTimelineEventRecord(
  tx: Prisma.TransactionClient,
  input: CreateTimelineEventRecordInput,
) {
  await tx.timelineEvent.create({
    data: {
      id: input.id ?? ulid(),
      actorId: input.actorUserId,
      after: toTimelineJson(input.after),
      before: toTimelineJson(input.before),
      createdById: input.actorUserId,
      detail: input.detail,
      eventType: input.eventType,
      metadata: toTimelineJson(
        normalizeTimelineMetadata({
          after: input.after,
          before: input.before,
          metadata: input.metadata,
          targetWorkItemType: input.targetWorkItemType,
        }),
      ),
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: input.targetType,
      title: input.title,
      updatedById: input.actorUserId,
    },
  });
}

export function normalizeTimelineMetadata(input: {
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  metadata?: TimelineEventMetadata;
  targetWorkItemType?: WorkItemType;
}): TimelineEventMetadata | undefined {
  const metadata: TimelineEventMetadata = removeUndefined({
    ...(input.metadata ?? {}),
    ...(input.targetWorkItemType
      ? { targetWorkItemType: input.targetWorkItemType }
      : {}),
  });
  const changedFields = resolveChangedFields(input.before, input.after);

  if (changedFields.length > 0 && !metadata.changedFields) {
    metadata.changedFields = changedFields;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function toTimelineJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonObject | undefined {
  return value && Object.keys(value).length > 0
    ? (value as Prisma.InputJsonObject)
    : undefined;
}

function resolveChangedFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
) {
  if (!before || !after) {
    return [];
  }

  return Object.keys(after).filter(
    (key) => !isTimelineValueEqual(before[key], after[key]),
  );
}

function isTimelineValueEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
