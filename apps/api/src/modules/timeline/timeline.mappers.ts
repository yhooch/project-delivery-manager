import type {
  TargetType,
  TimelineActor,
  TimelineEvent,
  TimelineEventType,
} from "@project-delivery/shared";

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

export function toTimelineEvent(
  record: PrismaTimelineEventRecord,
  targetTitle?: string,
): TimelineEvent {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    target: {
      type: record.targetType,
      id: record.targetId,
      title: targetTitle,
    },
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
