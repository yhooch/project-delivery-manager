import {
  ListAuthorizedMcpClientsResponseSchema,
  McpAuthorizeApprovalPath,
  McpAuthorizePath,
  McpOAuthApproveAuthorizationResponseSchema,
  McpOAuthAuthorizeContextSchema,
  RevokeAuthorizedMcpClientRequestSchema,
  RevokeAuthorizedMcpClientResponseSchema,
  type ApiError,
  type ListAuthorizedMcpClientsResponse,
  type McpOAuthAuthorizeContext,
  type RevokeAuthorizedMcpClientResponse,
} from "@project-delivery/shared";

import {
  API_BASE_PATH,
  apiClient,
  type ApiRequestInit,
} from "./api-client";

export type McpApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

export type McpOAuthAuthorizeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type McpOAuthAuthorizeErrorInput = {
  code: string;
  message: string;
  status: number;
};

const defaultApi: McpApiTransport = apiClient;
const apiPrefixSuffix = "/api/v1";
const accessDeniedDescription = "The user denied the authorization request.";

export class McpOAuthAuthorizeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor({ code, message, status }: McpOAuthAuthorizeErrorInput) {
    super(message);
    this.name = "McpOAuthAuthorizeError";
    this.code = code;
    this.status = status;
  }
}

export async function listAuthorizedMcpClients(
  api: McpApiTransport = defaultApi,
): Promise<ListAuthorizedMcpClientsResponse> {
  const response =
    await api.get<ListAuthorizedMcpClientsResponse>(
      "/users/me/mcp/authorized-clients",
    );

  return ListAuthorizedMcpClientsResponseSchema.parse(response.data);
}

export async function revokeAuthorizedMcpClient(
  clientId: string,
  api: McpApiTransport = defaultApi,
): Promise<RevokeAuthorizedMcpClientResponse> {
  const body = RevokeAuthorizedMcpClientRequestSchema.parse({ clientId });
  const response = await api.post<RevokeAuthorizedMcpClientResponse>(
    "/users/me/mcp/authorized-clients/revoke",
    body,
  );

  return RevokeAuthorizedMcpClientResponseSchema.parse(response.data);
}

export async function getMcpOAuthAuthorizeContext(
  query: string | URLSearchParams,
  fetcher: McpOAuthAuthorizeFetch = getDefaultFetch(),
): Promise<McpOAuthAuthorizeContext> {
  const response = await fetcher(createMcpOAuthAuthorizeUrl(query), {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    method: "GET",
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw toMcpOAuthAuthorizeError(payload, response);
  }

  return McpOAuthAuthorizeContextSchema.parse(payload);
}

export async function approveMcpOAuthAuthorization(
  query: string | URLSearchParams,
  fetcher: McpOAuthAuthorizeFetch = getDefaultFetch(),
): Promise<string> {
  const response = await fetcher(createMcpOAuthApproveAuthorizeUrl(query), {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    method: "POST",
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw toMcpOAuthAuthorizeError(payload, response);
  }

  return McpOAuthApproveAuthorizationResponseSchema.parse(payload).redirectTo;
}

export function createMcpOAuthAuthorizeUrl(
  query: string | URLSearchParams,
  basePath = getMcpOAuthBasePath(),
): string {
  const url = createUrl(basePath, McpAuthorizePath);
  const searchParams = toSearchParams(query);

  searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  return formatUrl(url, basePath);
}

export function createMcpOAuthApproveAuthorizeUrl(
  query: string | URLSearchParams,
  basePath = getMcpOAuthBasePath(),
): string {
  const url = createUrl(basePath, McpAuthorizeApprovalPath);
  const searchParams = toSearchParams(query);

  searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  return formatUrl(url, basePath);
}

export function createMcpOAuthAccessDeniedUrl(
  context: McpOAuthAuthorizeContext,
): string {
  const url = new URL(context.redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", accessDeniedDescription);

  if (context.state) {
    url.searchParams.set("state", context.state);
  }

  return url.toString();
}

export function getMcpOAuthBasePath(apiBasePath = API_BASE_PATH): string {
  const explicit = process.env.NEXT_PUBLIC_OAUTH_BASE_PATH?.trim();

  if (explicit) {
    return explicit.replace(/\/$/u, "");
  }

  const normalized = apiBasePath.trim().replace(/\/$/u, "");

  if (normalized.endsWith(apiPrefixSuffix)) {
    return normalized.slice(0, -apiPrefixSuffix.length);
  }

  return normalized;
}

export function isUnauthorizedMcpOAuthAuthorizeError(error: unknown): boolean {
  return (
    error instanceof McpOAuthAuthorizeError &&
    (error.status === 401 || error.code === "UNAUTHORIZED")
  );
}

function createUrl(basePath: string, path: string): URL {
  const normalizedBase = basePath.trim().replace(/\/$/u, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;

  return new URL(
    `${normalizedBase}${suffix}`,
    isAbsoluteUrl(normalizedBase) ? undefined : "http://local",
  );
}

function formatUrl(url: URL, basePath: string): string {
  return isAbsoluteUrl(basePath) ? url.toString() : `${url.pathname}${url.search}`;
}

function toSearchParams(query: string | URLSearchParams): URLSearchParams {
  if (typeof query === "string") {
    return new URLSearchParams(query.replace(/^\?/u, ""));
  }

  return new URLSearchParams(query);
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//u.test(value);
}

function getDefaultFetch(): McpOAuthAuthorizeFetch {
  if (typeof fetch === "undefined") {
    throw new Error("fetch is not available");
  }

  return fetch.bind(globalThis);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toMcpOAuthAuthorizeError(
  payload: unknown,
  response: Response,
): McpOAuthAuthorizeError {
  if (isApiError(payload)) {
    return new McpOAuthAuthorizeError({
      code: payload.code,
      message: payload.message,
      status: response.status,
    });
  }

  if (isOAuthProtocolError(payload)) {
    return new McpOAuthAuthorizeError({
      code: payload.error,
      message: payload.error_description ?? payload.error,
      status: response.status,
    });
  }

  return new McpOAuthAuthorizeError({
    code: response.status === 401 ? "UNAUTHORIZED" : "BAD_REQUEST",
    message: response.statusText || "Authorization request failed",
    status: response.status,
  });
}

function isApiError(payload: unknown): payload is ApiError {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Partial<ApiError>;

  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.requestId === "string"
  );
}

function isOAuthProtocolError(
  payload: unknown,
): payload is { error: string; error_description?: string } {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as {
    error?: unknown;
    error_description?: unknown;
  };

  return (
    typeof candidate.error === "string" &&
    (candidate.error_description === undefined ||
      typeof candidate.error_description === "string")
  );
}
