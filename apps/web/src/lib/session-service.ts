import type {
  AppSession,
  ChangePasswordRequest,
  ChangePasswordResponse,
  CreateOrganizationRequest,
  GetAuthSessionResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  Organization,
  RegisterRequest,
  RegisterResponse,
  UpdateUserPreferencesRequest,
  UpdateUserPreferencesResponse,
} from "@project-delivery/shared";

import { apiClient, type ApiRequestInit } from "./api-client";

export type SessionApiTransport = {
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

const defaultApi: SessionApiTransport = apiClient;

export async function registerAccount(
  input: RegisterRequest,
  api: SessionApiTransport = defaultApi,
): Promise<AppSession> {
  const response = await api.post<RegisterResponse>("/auth/register", input);

  return response.data;
}

export async function loginAccount(
  input: LoginRequest,
  api: SessionApiTransport = defaultApi,
): Promise<AppSession> {
  const response = await api.post<LoginResponse>("/auth/login", input);

  return response.data;
}

export async function logoutAccount(
  api: SessionApiTransport = defaultApi,
): Promise<void> {
  await api.post<LogoutResponse>("/auth/logout", {});
}

export async function getAppSession(
  recentOrganizationId?: string,
  recentSpaceIdOrApi?: string | SessionApiTransport,
  api: SessionApiTransport = defaultApi,
): Promise<AppSession> {
  const recentSpaceId =
    typeof recentSpaceIdOrApi === "string" ? recentSpaceIdOrApi : undefined;
  const transport =
    typeof recentSpaceIdOrApi === "string"
      ? api
      : (recentSpaceIdOrApi ?? defaultApi);
  const query = {
    ...(recentOrganizationId ? { recentOrganizationId } : {}),
    ...(recentSpaceId ? { recentSpaceId } : {}),
  };
  const response = await transport.get<GetAuthSessionResponse>("/auth/session", {
    query: Object.keys(query).length > 0 ? query : undefined,
  });

  return response.data;
}

export async function createOrganization(
  input: CreateOrganizationRequest,
  api: SessionApiTransport = defaultApi,
): Promise<Organization> {
  const response = await api.post<Organization>(
    "/organizations",
    input,
  );

  return response.data;
}

export async function createOrganizationAndRefreshSession(
  input: CreateOrganizationRequest,
  api: SessionApiTransport = defaultApi,
): Promise<AppSession> {
  const organization = await createOrganization(input, api);

  return getAppSession(organization.id, api);
}

export async function switchOrganization(
  organizationId: string,
  api: SessionApiTransport = defaultApi,
): Promise<AppSession> {
  return getAppSession(organizationId, api);
}

export async function switchSpace(
  organizationId: string,
  spaceId: string,
  api: SessionApiTransport = defaultApi,
): Promise<AppSession> {
  return getAppSession(organizationId, spaceId, api);
}

export async function updateUserPreferences(
  input: UpdateUserPreferencesRequest,
  api: SessionApiTransport = defaultApi,
): Promise<UpdateUserPreferencesResponse> {
  const response = await api.patch<UpdateUserPreferencesResponse>(
    "/users/me/preferences",
    input,
  );

  return response.data;
}

export async function changePassword(
  input: ChangePasswordRequest,
  api: SessionApiTransport = defaultApi,
): Promise<ChangePasswordResponse> {
  const response = await api.patch<ChangePasswordResponse>(
    "/users/me/password",
    input,
  );

  return response.data;
}
