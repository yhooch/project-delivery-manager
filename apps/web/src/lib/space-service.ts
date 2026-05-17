import type {
  AddOrganizationMemberRequest,
  AddSpaceMemberRequest,
  CreateSpaceRequest,
  Organization,
  PageResult,
  OrganizationMemberWithUser,
  RecordStatus,
  Space,
  SpaceMemberWithUser,
  SpaceRole,
  SpaceSummary,
  UpdateOrganizationMemberRequest,
  UpdateOrganizationRequest,
  UpdateSpaceMemberRequest,
  UpdateSpaceRequest,
} from "@project-delivery/shared";

import { apiClient, type ApiRequestInit } from "./api-client";

export type WorkspaceApiTransport = {
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

const defaultApi: WorkspaceApiTransport = apiClient;
const defaultPageQuery = {
  page: 1,
  pageSize: 200,
} as const;

export type ListSpaceMembersOptions = {
  role?: SpaceRole;
  status?: RecordStatus;
};

export async function listOrganizationMembers(
  organizationId: string,
  api: WorkspaceApiTransport = defaultApi,
): Promise<PageResult<OrganizationMemberWithUser>> {
  const response = await api.get<PageResult<OrganizationMemberWithUser>>(
    `/organizations/${organizationId}/members`,
    {
      query: defaultPageQuery,
    },
  );

  return response.data;
}

export async function addOrganizationMember(
  organizationId: string,
  input: AddOrganizationMemberRequest,
  api: WorkspaceApiTransport = defaultApi,
): Promise<OrganizationMemberWithUser> {
  const response = await api.post<OrganizationMemberWithUser>(
    `/organizations/${organizationId}/members`,
    input,
  );

  return response.data;
}

export async function updateOrganizationMember(
  organizationId: string,
  memberId: string,
  input: UpdateOrganizationMemberRequest,
  api: WorkspaceApiTransport = defaultApi,
): Promise<OrganizationMemberWithUser> {
  const response = await api.patch<OrganizationMemberWithUser>(
    `/organizations/${organizationId}/members/${memberId}`,
    input,
  );

  return response.data;
}

export async function updateOrganization(
  organizationId: string,
  input: UpdateOrganizationRequest,
  api: WorkspaceApiTransport = defaultApi,
): Promise<Organization> {
  const response = await api.patch<Organization>(
    `/organizations/${organizationId}`,
    input,
  );

  return response.data;
}

export async function disableOrganizationMember(
  organizationId: string,
  memberId: string,
  api: WorkspaceApiTransport = defaultApi,
): Promise<OrganizationMemberWithUser> {
  const response = await api.patch<OrganizationMemberWithUser>(
    `/organizations/${organizationId}/members/${memberId}`,
    { status: "DISABLED" },
  );

  return response.data;
}

export async function listSpaces(
  organizationId: string,
  api: WorkspaceApiTransport = defaultApi,
): Promise<PageResult<SpaceSummary>> {
  const response = await api.get<PageResult<SpaceSummary>>(
    `/organizations/${organizationId}/spaces`,
    {
      query: defaultPageQuery,
    },
  );

  return response.data;
}

export async function createSpace(
  organizationId: string,
  input: CreateSpaceRequest,
  api: WorkspaceApiTransport = defaultApi,
): Promise<Space> {
  const response = await api.post<Space>(
    `/organizations/${organizationId}/spaces`,
    input,
  );

  return response.data;
}

export async function getSpace(
  spaceId: string,
  api: WorkspaceApiTransport = defaultApi,
): Promise<Space> {
  const response = await api.get<Space>(`/spaces/${spaceId}`);

  return response.data;
}

export async function updateSpace(
  spaceId: string,
  input: UpdateSpaceRequest,
  api: WorkspaceApiTransport = defaultApi,
): Promise<Space> {
  const response = await api.patch<Space>(`/spaces/${spaceId}`, input);

  return response.data;
}

export async function listSpaceMembers(
  spaceId: string,
  optionsOrApi: ListSpaceMembersOptions | WorkspaceApiTransport = {},
  api: WorkspaceApiTransport = defaultApi,
): Promise<PageResult<SpaceMemberWithUser>> {
  const options = isWorkspaceApiTransport(optionsOrApi) ? {} : optionsOrApi;
  const transport = isWorkspaceApiTransport(optionsOrApi) ? optionsOrApi : api;
  const response = await transport.get<PageResult<SpaceMemberWithUser>>(
    `/spaces/${spaceId}/members`,
    {
      query: {
        ...defaultPageQuery,
        ...options,
      },
    },
  );

  return response.data;
}

export async function addSpaceMember(
  spaceId: string,
  input: AddSpaceMemberRequest,
  api: WorkspaceApiTransport = defaultApi,
): Promise<SpaceMemberWithUser> {
  const response = await api.post<SpaceMemberWithUser>(
    `/spaces/${spaceId}/members`,
    input,
  );

  return response.data;
}

export async function updateSpaceMember(
  spaceId: string,
  memberId: string,
  input: UpdateSpaceMemberRequest,
  api: WorkspaceApiTransport = defaultApi,
): Promise<SpaceMemberWithUser> {
  const response = await api.patch<SpaceMemberWithUser>(
    `/spaces/${spaceId}/members/${memberId}`,
    input,
  );

  return response.data;
}

export function canManageOrganization(role: string | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

export function isActiveStatus(status: RecordStatus | undefined) {
  return status === "ACTIVE";
}

export function canCreateSpaceInOrganization(
  role: string | undefined,
  status: RecordStatus | undefined,
) {
  return canManageOrganization(role) && isActiveStatus(status);
}

function isWorkspaceApiTransport(
  value: ListSpaceMembersOptions | WorkspaceApiTransport,
): value is WorkspaceApiTransport {
  return typeof (value as WorkspaceApiTransport).get === "function";
}

export type {
  OrganizationMemberWithUser,
  Space,
  SpaceMemberWithUser,
  SpaceSummary,
};
