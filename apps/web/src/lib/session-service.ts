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
const recentOrganizationStorageKey = "pdm.recentOrganizationId";
const recentSpaceStorageKey = "pdm.recentSpaceId";

export type RecentSessionStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export type RecentSessionSelection = {
  recentOrganizationId?: string;
  recentSpaceId?: string;
};

export async function registerAccount(
  input: RegisterRequest,
  api: SessionApiTransport = defaultApi,
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): Promise<AppSession> {
  const response = await api.post<RegisterResponse>("/auth/register", input);
  persistRecentSessionSelection(response.data, recentStorage);

  return response.data;
}

export async function loginAccount(
  input: LoginRequest,
  api: SessionApiTransport = defaultApi,
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): Promise<AppSession> {
  await api.post<LoginResponse>("/auth/login", input);

  return getPersistedAppSession(api, recentStorage);
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

export async function getPersistedAppSession(
  api: SessionApiTransport = defaultApi,
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): Promise<AppSession> {
  const recent = readRecentSessionSelection(recentStorage);

  return refreshAppSession(
    recent.recentOrganizationId,
    recent.recentSpaceId,
    api,
    recentStorage,
  );
}

export async function refreshAppSession(
  recentOrganizationId?: string,
  recentSpaceId?: string,
  api: SessionApiTransport = defaultApi,
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): Promise<AppSession> {
  const session = recentSpaceId
    ? await getAppSession(recentOrganizationId, recentSpaceId, api)
    : await getAppSession(recentOrganizationId, api);
  persistRecentSessionSelection(session, recentStorage);

  return session;
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
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): Promise<AppSession> {
  const organization = await createOrganization(input, api);

  return refreshAppSession(organization.id, undefined, api, recentStorage);
}

export async function switchOrganization(
  organizationId: string,
  api: SessionApiTransport = defaultApi,
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): Promise<AppSession> {
  return refreshAppSession(organizationId, undefined, api, recentStorage);
}

export async function switchSpace(
  organizationId: string,
  spaceId: string,
  api: SessionApiTransport = defaultApi,
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): Promise<AppSession> {
  return refreshAppSession(organizationId, spaceId, api, recentStorage);
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

export function readRecentSessionSelection(
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): RecentSessionSelection {
  return {
    recentOrganizationId:
      recentStorage?.getItem(recentOrganizationStorageKey) || undefined,
    recentSpaceId: recentStorage?.getItem(recentSpaceStorageKey) || undefined,
  };
}

export function persistRecentSessionSelection(
  session: AppSession,
  recentStorage: RecentSessionStorage | undefined = getRecentSessionStorage(),
): void {
  if (!recentStorage) {
    return;
  }

  if (!session.defaultOrganizationId) {
    recentStorage.removeItem(recentOrganizationStorageKey);
    recentStorage.removeItem(recentSpaceStorageKey);
    return;
  }

  recentStorage.setItem(
    recentOrganizationStorageKey,
    session.defaultOrganizationId,
  );

  const defaultSpace = session.defaultSpaceId
    ? session.spaces.find((space) => space.id === session.defaultSpaceId)
    : undefined;

  if (defaultSpace?.organizationId === session.defaultOrganizationId) {
    recentStorage.setItem(recentSpaceStorageKey, defaultSpace.id);
    return;
  }

  recentStorage.removeItem(recentSpaceStorageKey);
}

function getRecentSessionStorage(): RecentSessionStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
