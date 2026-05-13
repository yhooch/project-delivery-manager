import type { TimelineEvent } from "@project-delivery/shared";

import type {
  CreateTimelineEventInput,
  TimelineListInput,
  TimelineListResult,
} from "./timeline.types";

export const TIMELINE_REPOSITORY = Symbol("TIMELINE_REPOSITORY");

export type TimelineRepository = {
  create(input: CreateTimelineEventInput): Promise<TimelineEvent>;
  listByTarget(input: TimelineListInput): Promise<TimelineListResult>;
};
