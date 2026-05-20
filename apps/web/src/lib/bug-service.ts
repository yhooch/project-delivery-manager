import {
  BugListQuerySchema,
  CreateBugRequestSchema,
  CreateBugResponseSchema,
  GetBugResponseSchema,
  ListBugsResponseSchema,
  UpdateBugRequestSchema,
  UpdateBugResponseSchema,
  type BugSeverity,
  type BugLifecycleFilterBucket,
  type BugView,
  type CreateBugRequest,
  type ListBugsResponse,
  type Priority,
  type StatusCategory,
  type UpdateBugRequest,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";
import { normalizeTagApiQuery } from "./tag-query";

export type BugApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  patch<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

export type ListBugsInput = z.input<typeof BugListQuerySchema> & {
  organizationId?: string;
  spaceId: string;
};

export type BugIdentityInput = {
  bugId: string;
  organizationId?: string;
  spaceId: string;
};

export type CreateBugInput = CreateBugRequest;
export type UpdateBugInput = UpdateBugRequest;

export type BugListFilterState = {
  assigneeId?: string;
  lifecycleBucket?: BugLifecycleFilterBucket;
  priority?: Priority;
  relatedTaskId?: string;
  reporterId?: string;
  requirementId?: string;
  severity?: BugSeverity;
  statusCategory?: StatusCategory;
  versionId?: string;
};

const defaultApi: BugApiTransport = apiClient;

export async function listBugs(
  input: ListBugsInput,
  api: BugApiTransport = defaultApi,
): Promise<ListBugsResponse> {
  const { organizationId: _organizationId, spaceId, ...filters } = input;
  const query = BugListQuerySchema.parse({
    ...filters,
    type: "BUG",
  });
  const response = await api.get<unknown>(`/spaces/${spaceId}/bugs`, {
    query: normalizeTagApiQuery(query),
  });

  return ListBugsResponseSchema.parse(response.data);
}

export async function createBug(
  context: { organizationId?: string; spaceId: string },
  input: CreateBugInput,
  api: BugApiTransport = defaultApi,
): Promise<BugView> {
  const { organizationId: _organizationId, spaceId } = context;
  const body = CreateBugRequestSchema.parse(input);
  const response = await api.post<unknown>(`/spaces/${spaceId}/bugs`, body);

  return CreateBugResponseSchema.parse(response.data);
}

export async function getBug(
  input: BugIdentityInput,
  api: BugApiTransport = defaultApi,
): Promise<BugView> {
  const { bugId, organizationId: _organizationId, spaceId: _spaceId } = input;
  const response = await api.get<unknown>(`/bugs/${bugId}`);

  return GetBugResponseSchema.parse(response.data);
}

export async function updateBug(
  context: BugIdentityInput,
  input: UpdateBugInput,
  api: BugApiTransport = defaultApi,
): Promise<BugView> {
  const { bugId, organizationId: _organizationId, spaceId: _spaceId } = context;
  const body = UpdateBugRequestSchema.parse(input);
  const response = await api.patch<unknown>(`/bugs/${bugId}`, body);

  return UpdateBugResponseSchema.parse(response.data);
}
