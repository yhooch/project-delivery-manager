import type {
  TargetType,
  TimelineActor,
  TimelineEvent,
  TimelineEventType,
  WorkItemType,
} from "@project-delivery/shared";

import { formatDisplayCode } from "../object-code/object-code.types";

type TimelineActorRecord = {
  avatar: string | null;
  id: string;
  name: string;
  username: string;
};

type PrismaTimelineEventRecord = {
  actor: TimelineActorRecord;
  after: unknown;
  before: unknown;
  createdAt: Date;
  detail: string | null;
  eventType: TimelineEventType;
  id: string;
  metadata: unknown;
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: TargetType;
  title: string;
};

export type TimelineTargetIdentityRecord = {
  targetKind?: "REQUIREMENT";
  sequence?: number | null;
  title?: string;
  workItemType?: WorkItemType | null;
};

export function toTimelineEvent(
  record: PrismaTimelineEventRecord,
  targetIdentity?: string | TimelineTargetIdentityRecord,
): TimelineEvent {
  const target =
    typeof targetIdentity === "string"
      ? { title: targetIdentity }
      : targetIdentity;

  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    target: removeUndefined({
      type: record.targetType,
      id: record.targetId,
      title: nonEmptyTitle(target?.title),
      ...toTimelineTargetDisplayIdentity(record.targetType, target),
    }),
    eventType: record.eventType,
    actor: toTimelineActor(record.actor),
    title: record.title,
    detail: record.detail ?? undefined,
    before: toOptionalRecord(record.before),
    after: toOptionalRecord(record.after),
    metadata: toOptionalRecord(record.metadata),
    createdAt: record.createdAt.toISOString(),
  };
}

function toTimelineTargetDisplayIdentity(
  targetType: TargetType,
  target?: TimelineTargetIdentityRecord,
) {
  const sequence = target?.sequence ?? null;

  if (sequence == null) {
    return {};
  }

  if (targetType === "DOCUMENT" && target?.targetKind === "REQUIREMENT") {
    return {
      sequence,
      displayCode: formatDisplayCode("REQUIREMENT", sequence),
    };
  }

  if (targetType === "INTAKE_ITEM") {
    return {
      sequence,
      displayCode: formatDisplayCode("INTAKE_ITEM", sequence),
    };
  }

  if (targetType === "WORK_ITEM" && target?.workItemType) {
    return {
      sequence,
      displayCode: formatDisplayCode(target.workItemType, sequence),
    };
  }

  return {};
}

function nonEmptyTitle(title: string | undefined): string | undefined {
  const trimmed = title?.trim();

  return trimmed ? title : undefined;
}

function toTimelineActor(record: TimelineActorRecord): TimelineActor {
  return {
    id: record.id,
    username: record.username,
    name: record.name,
    avatar: record.avatar ?? undefined,
  };
}

function toOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
