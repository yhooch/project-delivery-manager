import type {
  PageResult,
  TargetType,
  TimelineEvent,
  TimelineEventType,
} from "@project-delivery/shared";

export type TimelineListInput = {
  organizationId: string;
  page: number;
  pageSize: number;
  spaceId: string;
  targetId: string;
  targetTitle?: string;
  targetType: TargetType;
};

export type TimelineListResult = PageResult<TimelineEvent>;

export type CreateTimelineEventInput = {
  actorId: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  createdById: string;
  detail?: string;
  eventType: TimelineEventType;
  id: string;
  metadata?: Record<string, unknown>;
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetTitle?: string;
  targetType: TargetType;
  title: string;
};
