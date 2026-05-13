import {
  CreateVersionResponseSchema,
  GetVersionResponseSchema,
  ListSpaceMembersResponseSchema,
  ListVersionsResponseSchema,
  UpdateVersionResponseSchema,
  type CreateVersionRequest,
  type PageResult,
  type SpaceMemberWithUser,
  type UpdateVersionRequest,
  type Version,
  type VersionStatus,
} from "@project-delivery/shared";

import { apiClient, type ApiRequestInit } from "./api-client";

export type VersionApiTransport = {
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

type ListVersionsInput = {
  organizationId?: string;
  ownerId?: string;
  page?: number;
  pageSize?: number;
  spaceId: string;
  status?: VersionStatus;
};

type VersionIdentityInput = {
  organizationId?: string;
  spaceId?: string;
  versionId: string;
};

type WriteVersionInput = {
  organizationId?: string;
  spaceId: string;
};

type ListAssignableMembersInput = {
  organizationId?: string;
  pageSize?: number;
  spaceId: string;
};

const defaultApi: VersionApiTransport = apiClient;

export async function listVersions(
  input: ListVersionsInput,
  api: VersionApiTransport = defaultApi,
): Promise<PageResult<Version>> {
  const { organizationId: _organizationId, spaceId, ...query } = input;
  const response = await api.get<PageResult<Version>>(
    `/spaces/${spaceId}/versions`,
    {
      query,
    },
  );

  return ListVersionsResponseSchema.parse(response.data);
}

export async function createVersion(
  context: WriteVersionInput,
  input: CreateVersionRequest,
  api: VersionApiTransport = defaultApi,
): Promise<Version> {
  const { organizationId: _organizationId, spaceId } = context;
  const response = await api.post<Version>(
    `/spaces/${spaceId}/versions`,
    input,
  );

  return CreateVersionResponseSchema.parse(response.data);
}

export async function getVersion(
  input: VersionIdentityInput,
  api: VersionApiTransport = defaultApi,
): Promise<Version> {
  const { organizationId: _organizationId, spaceId: _spaceId, versionId } = input;
  const response = await api.get<Version>(`/versions/${versionId}`);

  return GetVersionResponseSchema.parse(response.data);
}

export async function updateVersion(
  context: VersionIdentityInput,
  input: UpdateVersionRequest,
  api: VersionApiTransport = defaultApi,
): Promise<Version> {
  const { organizationId: _organizationId, spaceId: _spaceId, versionId } =
    context;
  const response = await api.patch<Version>(`/versions/${versionId}`, input);

  return UpdateVersionResponseSchema.parse(response.data);
}

export async function listVersionAssignableMembers(
  input: ListAssignableMembersInput,
  api: VersionApiTransport = defaultApi,
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
