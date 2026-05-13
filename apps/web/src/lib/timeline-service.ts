import {
  TimelineQuerySchema,
  TimelineResponseSchema,
  WorkItemTimelineQuerySchema,
  type PageResult,
  type TargetType,
  type TimelineEvent,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";

export type TimelineApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
};

export type ListTimelineInput = z.input<typeof TimelineQuerySchema> & {
  organizationId?: string;
  spaceId: string;
};

export type ListWorkItemTimelineInput = z.input<
  typeof WorkItemTimelineQuerySchema
> & {
  organizationId?: string;
  spaceId: string;
  workItemId: string;
};

export type TimelineTargetIdentity = {
  organizationId?: string;
  spaceId: string;
  targetId: string;
  targetType: TargetType;
};

const defaultApi: TimelineApiTransport = apiClient;

export async function listTimeline(
  input: ListTimelineInput,
  api: TimelineApiTransport = defaultApi,
): Promise<PageResult<TimelineEvent>> {
  const { organizationId: _organizationId, spaceId: _spaceId, ...filters } =
    input;
  const query = TimelineQuerySchema.parse(filters);
  const response = await api.get<unknown>("/timeline", {
    query,
  });

  return TimelineResponseSchema.parse(response.data);
}

export async function listWorkItemTimeline(
  input: ListWorkItemTimelineInput,
  api: TimelineApiTransport = defaultApi,
): Promise<PageResult<TimelineEvent>> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workItemId,
    ...filters
  } = input;
  const query = WorkItemTimelineQuerySchema.parse(filters);
  const response = await api.get<unknown>(`/work-items/${workItemId}/timeline`, {
    query,
  });

  return TimelineResponseSchema.parse(response.data);
}
