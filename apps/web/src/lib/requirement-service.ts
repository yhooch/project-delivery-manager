import {
  CreateRequirementDraftResponseSchema,
  DeleteRequirementDraftResponseSchema,
  GetRequirementResponseSchema,
  ListRequirementsResponseSchema,
  ListSpaceMembersResponseSchema,
  ListVersionsResponseSchema,
  UpdateRequirementResponseSchema,
  type CreateRequirementDraftRequest,
  type PageResult,
  type Requirement,
  type RequirementStatus,
  type SpaceMemberWithUser,
  type UpdateRequirementRequest,
  type Version,
} from "@project-delivery/shared";

import { apiClient, type ApiRequestInit } from "./api-client";

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

export type ListRequirementsInput = {
  includeDrafts?: boolean;
  organizationId?: string;
  ownerId?: string;
  page?: number;
  pageSize?: number;
  spaceId: string;
  status?: RequirementStatus;
  versionId?: string;
};

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
): Promise<PageResult<Requirement>> {
  const { organizationId: _organizationId, spaceId, ...query } = input;
  const response = await api.get<PageResult<Requirement>>(
    `/spaces/${spaceId}/requirements`,
    {
      query,
    },
  );

  return ListRequirementsResponseSchema.parse(response.data);
}

export async function createRequirementDraft(
  context: WriteRequirementInput,
  input: CreateRequirementDraftRequest = {},
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
  context: RequirementIdentityInput,
  api: RequirementApiTransport = defaultApi,
): Promise<Requirement> {
  return updateRequirement(context, { status: "ARCHIVED" }, api);
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
