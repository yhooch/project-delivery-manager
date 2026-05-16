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
import {
  RecentOrganizationCookieName as recentOrganizationCookieName,
  RecentSpaceCookieName as recentSpaceCookieName,
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
const recentOrganizationStorageKey = recentOrganizationCookieName;
const recentSpaceStorageKey = recentSpaceCookieName;
const recentCookieMaxAgeSeconds = 60 * 60 * 24 * 180;

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
  persistRecentSessionSelectionRequest(recentOrganizationId, recentSpaceId);
  const response = await transport.get<GetAuthSessionResponse>("/auth/session");

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
  persistRecentSessionSelectionRequest(
    recentOrganizationId,
    recentSpaceId,
    recentStorage,
  );
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
    removeRecentCookie(recentOrganizationStorageKey);
    removeRecentCookie(recentSpaceStorageKey);
    return;
  }

  recentStorage.setItem(
    recentOrganizationStorageKey,
    session.defaultOrganizationId,
  );
  setRecentCookie(recentOrganizationStorageKey, session.defaultOrganizationId);

  const defaultSpace = session.defaultSpaceId
    ? session.spaces.find((space) => space.id === session.defaultSpaceId)
    : undefined;

  if (defaultSpace?.organizationId === session.defaultOrganizationId) {
    recentStorage.setItem(recentSpaceStorageKey, defaultSpace.id);
    setRecentCookie(recentSpaceStorageKey, defaultSpace.id);
    return;
  }

  recentStorage.removeItem(recentSpaceStorageKey);
  removeRecentCookie(recentSpaceStorageKey);
}

function persistRecentSessionSelectionRequest(
  recentOrganizationId?: string,
  recentSpaceId?: string,
  recentStorage?: RecentSessionStorage,
): void {
  if (recentOrganizationId) {
    recentStorage?.setItem(recentOrganizationStorageKey, recentOrganizationId);
    setRecentCookie(recentOrganizationStorageKey, recentOrganizationId);
  }

  if (recentSpaceId) {
    recentStorage?.setItem(recentSpaceStorageKey, recentSpaceId);
    setRecentCookie(recentSpaceStorageKey, recentSpaceId);
    return;
  }

  if (recentOrganizationId) {
    recentStorage?.removeItem(recentSpaceStorageKey);
    removeRecentCookie(recentSpaceStorageKey);
  }
}

function setRecentCookie(name: string, value: string): void {
  const cookieTarget = getCookieTarget();

  if (!cookieTarget) {
    return;
  }

  cookieTarget.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value,
  )}; Max-Age=${recentCookieMaxAgeSeconds}; Path=/; SameSite=Lax`;
}

function removeRecentCookie(name: string): void {
  const cookieTarget = getCookieTarget();

  if (!cookieTarget) {
    return;
  }

  cookieTarget.cookie = `${encodeURIComponent(
    name,
  )}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function getCookieTarget(): Pick<Document, "cookie"> | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  return document;
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
