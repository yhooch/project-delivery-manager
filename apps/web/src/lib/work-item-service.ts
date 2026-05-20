import {
  CreateWorkItemRequestSchema,
  CreateWorkItemResponseSchema,
  GetWorkItemResponseSchema,
  ListWorkItemsResponseSchema,
  UpdateWorkItemRequestSchema,
  UpdateWorkItemResponseSchema,
  WorkItemListQuerySchema,
  type CreateWorkItemRequest,
  type ListWorkItemsResponse,
  type Priority,
  type StatusCategory,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemDetail,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";
import { normalizeTagApiQuery } from "./tag-query";

export type WorkItemApiTransport = {
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

export type ListWorkItemsInput = z.input<typeof WorkItemListQuerySchema> & {
  organizationId?: string;
  spaceId: string;
};

export type WorkItemIdentityInput = {
  organizationId?: string;
  spaceId?: string;
  workItemId: string;
};

export type CreateTaskInput = Omit<CreateWorkItemRequest, "type"> & {
  type?: "TASK";
};
export type UpdateTaskInput = UpdateWorkItemRequest;

export type TaskListFilterState = {
  assigneeId?: string;
  intakeItemId?: string;
  priority?: Priority;
  reporterId?: string;
  requirementId?: string;
  statusCategory?: StatusCategory;
  versionId?: string;
};

const defaultApi: WorkItemApiTransport = apiClient;

export async function listWorkItems(
  input: ListWorkItemsInput,
  api: WorkItemApiTransport = defaultApi,
): Promise<ListWorkItemsResponse> {
  const { organizationId: _organizationId, spaceId, ...filters } = input;
  const query = WorkItemListQuerySchema.parse({
    ...filters,
    type: "TASK",
  });
  const response = await api.get<unknown>(`/spaces/${spaceId}/work-items`, {
    query: normalizeTagApiQuery(query),
  });

  return ListWorkItemsResponseSchema.parse(response.data);
}

export async function createWorkItem(
  context: { organizationId?: string; spaceId: string },
  input: CreateTaskInput,
  api: WorkItemApiTransport = defaultApi,
): Promise<WorkItem> {
  const { organizationId: _organizationId, spaceId } = context;
  const body = CreateWorkItemRequestSchema.parse({
    ...input,
    type: "TASK",
  });
  const response = await api.post<unknown>(
    `/spaces/${spaceId}/work-items`,
    body,
  );

  return CreateWorkItemResponseSchema.parse(response.data);
}

export async function getWorkItem(
  input: WorkItemIdentityInput,
  api: WorkItemApiTransport = defaultApi,
): Promise<WorkItemDetail> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workItemId,
  } = input;
  const response = await api.get<unknown>(`/work-items/${workItemId}`);

  return GetWorkItemResponseSchema.parse(response.data);
}

export async function updateWorkItem(
  context: WorkItemIdentityInput,
  input: UpdateTaskInput,
  api: WorkItemApiTransport = defaultApi,
): Promise<WorkItem> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workItemId,
  } = context;
  const body = UpdateWorkItemRequestSchema.parse(input);
  const response = await api.patch<unknown>(`/work-items/${workItemId}`, body);

  return UpdateWorkItemResponseSchema.parse(response.data);
}
