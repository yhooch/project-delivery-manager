import {
  CreateTagRequestSchema,
  CreateTagResponseSchema,
  DeleteTagResponseSchema,
  GetTagAssignmentsQuerySchema,
  GetTagAssignmentsResponseSchema,
  ListTagFilterOptionsQuerySchema,
  ListTagFilterOptionsResponseSchema,
  ListTagsQuerySchema,
  ListTagsResponseSchema,
  ReplaceTagAssignmentsRequestSchema,
  ReplaceTagAssignmentsResponseSchema,
  type CreateTagRequest,
  type ListTagFilterOptionsResponse,
  type ReplaceTagAssignmentsRequest,
  type TagAssignmentsResponse,
  type TagDto,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";

export type TagApiTransport = {
  delete<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
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

export type ListTagsInput = z.input<typeof ListTagsQuerySchema> & {
  organizationId?: string;
  spaceId: string;
};

export type ListTagsResponse = z.infer<typeof ListTagsResponseSchema>;
export type ListTagFilterOptionsInput = z.input<
  typeof ListTagFilterOptionsQuerySchema
> & {
  organizationId?: string;
  spaceId: string;
};
export type { ListTagFilterOptionsResponse };
export type CreateTagInput = CreateTagRequest;
export type GetTagAssignmentsInput = z.input<
  typeof GetTagAssignmentsQuerySchema
>;
export type ReplaceTagAssignmentsInput = ReplaceTagAssignmentsRequest;

const defaultApi: TagApiTransport = apiClient;

export async function listTags(
  input: ListTagsInput,
  api: TagApiTransport = defaultApi,
): Promise<ListTagsResponse> {
  const { organizationId: _organizationId, spaceId, ...filters } = input;
  const query = ListTagsQuerySchema.parse(filters);
  const response = await api.get<unknown>(`/spaces/${spaceId}/tags`, {
    query,
  });

  return ListTagsResponseSchema.parse(response.data);
}

export async function listTagFilterOptions(
  input: ListTagFilterOptionsInput,
  api: TagApiTransport = defaultApi,
): Promise<ListTagFilterOptionsResponse> {
  const { organizationId: _organizationId, spaceId, ...filters } = input;
  const query = ListTagFilterOptionsQuerySchema.parse(filters);
  const response = await api.get<unknown>(
    `/spaces/${spaceId}/tag-filter-options`,
    {
      query,
    },
  );

  return ListTagFilterOptionsResponseSchema.parse(response.data);
}

export async function createTag(
  context: { organizationId?: string; spaceId: string },
  input: CreateTagInput,
  api: TagApiTransport = defaultApi,
): Promise<TagDto> {
  const { organizationId: _organizationId, spaceId } = context;
  const body = CreateTagRequestSchema.parse(input);
  const response = await api.post<unknown>(`/spaces/${spaceId}/tags`, body);

  return CreateTagResponseSchema.parse(response.data);
}

export async function deleteTag(
  tagId: string,
  api: TagApiTransport = defaultApi,
): Promise<void> {
  const response = await api.delete<unknown>(`/tags/${tagId}`);

  DeleteTagResponseSchema.parse(response.data);
}

export async function getTagAssignments(
  input: GetTagAssignmentsInput,
  api: TagApiTransport = defaultApi,
): Promise<TagAssignmentsResponse> {
  const query = GetTagAssignmentsQuerySchema.parse(input);
  const response = await api.get<unknown>("/tag-assignments", { query });

  return GetTagAssignmentsResponseSchema.parse(response.data);
}

export async function replaceTagAssignments(
  input: ReplaceTagAssignmentsInput,
  api: TagApiTransport = defaultApi,
): Promise<TagAssignmentsResponse> {
  const body = ReplaceTagAssignmentsRequestSchema.parse(input);
  const response = await api.patch<unknown>("/tag-assignments", body);

  return ReplaceTagAssignmentsResponseSchema.parse(response.data);
}
