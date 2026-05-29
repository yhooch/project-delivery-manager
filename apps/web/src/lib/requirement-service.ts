import {
  CreateRequirementDraftResponseSchema,
  DeleteRequirementDraftResponseSchema,
  GetRequirementResponseSchema,
  RequirementListQuerySchema,
  ListRequirementsResponseSchema,
  ListSpaceMembersResponseSchema,
  ListVersionsResponseSchema,
  UpdateRequirementResponseSchema,
  type CreateRequirementDraftRequest,
  type ListRequirementsResponse,
  type PageResult,
  type Requirement,
  type RequirementContentFormat,
  type SpaceMemberWithUser,
  type UpdateRequirementRequest,
  type Version,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";
import { normalizeTagApiQuery } from "./tag-query";

export type RequirementApiTransport = {
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

export type ListRequirementsInput = z.input<
  typeof RequirementListQuerySchema
> & {
  organizationId?: string;
  spaceId: string;
};

export type RequirementDraftContentFormat = RequirementContentFormat;

export type CreateRequirementDraftInput = CreateRequirementDraftRequest;

type RequirementIdentityInput = {
  organizationId?: string;
  requirementId: string;
  spaceId?: string;
};

type WriteRequirementInput = {
  organizationId?: string;
  spaceId: string;
};

type ListRequirementContextInput = {
  organizationId?: string;
  pageSize?: number;
  spaceId: string;
};

const defaultApi: RequirementApiTransport = apiClient;

export async function listRequirements(
  input: ListRequirementsInput,
  api: RequirementApiTransport = defaultApi,
): Promise<ListRequirementsResponse> {
  const { organizationId: _organizationId, spaceId, ...filters } = input;
  const query = RequirementListQuerySchema.parse(filters);
  const response = await api.get<PageResult<Requirement>>(
    `/spaces/${spaceId}/requirements`,
    {
      query: normalizeTagApiQuery(query),
    },
  );

  return ListRequirementsResponseSchema.parse(response.data);
}

export async function createRequirementDraft(
  context: WriteRequirementInput,
  input: CreateRequirementDraftInput = {},
  api: RequirementApiTransport = defaultApi,
): Promise<Requirement> {
  const { organizationId: _organizationId, spaceId } = context;
  const response = await api.post<Requirement>(
    `/spaces/${spaceId}/requirements`,
    input,
  );

  return CreateRequirementDraftResponseSchema.parse(response.data);
}

export async function getRequirement(
  input: RequirementIdentityInput,
  api: RequirementApiTransport = defaultApi,
): Promise<Requirement> {
  const {
    organizationId: _organizationId,
    requirementId,
    spaceId: _spaceId,
  } = input;
  const response = await api.get<Requirement>(`/requirements/${requirementId}`);

  return GetRequirementResponseSchema.parse(response.data);
}

export async function updateRequirement(
  context: RequirementIdentityInput,
  input: UpdateRequirementRequest,
  api: RequirementApiTransport = defaultApi,
): Promise<Requirement> {
  const {
    organizationId: _organizationId,
    requirementId,
    spaceId: _spaceId,
  } = context;
  const response = await api.patch<Requirement>(
    `/requirements/${requirementId}`,
    input,
  );

  return UpdateRequirementResponseSchema.parse(response.data);
}

export async function archiveRequirement(
  context: RequirementIdentityInput & { baseRevision: number },
  api: RequirementApiTransport = defaultApi,
): Promise<Requirement> {
  return updateRequirement(
    context,
    { baseRevision: context.baseRevision, status: "ARCHIVED" },
    api,
  );
}

export async function deleteRequirementDraft(
  context: RequirementIdentityInput,
  api: RequirementApiTransport = defaultApi,
): Promise<Record<string, never>> {
  const {
    organizationId: _organizationId,
    requirementId,
    spaceId: _spaceId,
  } = context;
  const response = await api.delete<unknown>(`/requirements/${requirementId}`);

  return DeleteRequirementDraftResponseSchema.parse(response.data);
}

export async function listRequirementVersions(
  input: ListRequirementContextInput,
  api: RequirementApiTransport = defaultApi,
): Promise<PageResult<Version>> {
  const { organizationId: _organizationId, pageSize = 100, spaceId } = input;
  const response = await api.get<PageResult<Version>>(
    `/spaces/${spaceId}/versions`,
    {
      query: {
        page: 1,
        pageSize,
      },
    },
  );

  return ListVersionsResponseSchema.parse(response.data);
}

export async function listRequirementAssignableMembers(
  input: ListRequirementContextInput,
  api: RequirementApiTransport = defaultApi,
): Promise<PageResult<SpaceMemberWithUser>> {
  const { organizationId: _organizationId, pageSize = 100, spaceId } = input;
  const response = await api.get<PageResult<SpaceMemberWithUser>>(
    `/spaces/${spaceId}/members`,
    {
      query: {
        page: 1,
        pageSize,
        status: "ACTIVE",
      },
    },
  );

  return ListSpaceMembersResponseSchema.parse(response.data);
}
