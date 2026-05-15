import type {
  ApiError,
  ApiErrorCode,
  ApiResponse,
} from "@project-delivery/shared";

export const API_BASE_PATH =
  process.env.NEXT_PUBLIC_API_BASE_PATH?.trim() || "/api/v1";

type QueryPrimitive = string | number | boolean;

export type ApiQuery =
  | Record<
      string,
      | QueryPrimitive
      | QueryPrimitive[]
      | null
      | undefined
    >
  | URLSearchParams;

export type ApiRequestInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  query?: ApiQuery;
};

export class ApiClientError extends Error {
  readonly error: ApiError;
  readonly response: Response;
  readonly status: number;

  constructor(error: ApiError, response: Response) {
    super(error.message);
    this.name = "ApiClientError";
    this.error = error;
    this.response = response;
    this.status = response.status;
  }
}

export async function apiRequest<TData>(
  path: string,
  init: ApiRequestInit = {},
): Promise<ApiResponse<TData>> {
  const { body, headers, query, ...requestInit } = init;
  const response = await fetch(createApiUrl(path, query), {
    credentials: "include",
    ...requestInit,
    body: serializeBody(body),
    headers: createHeaders(headers, body),
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw new ApiClientError(toApiError(payload, response), response);
  }

  return payload as ApiResponse<TData>;
}

export const apiClient = {
  delete<TData>(path: string, init?: ApiRequestInit) {
    return apiRequest<TData>(path, { ...init, method: "DELETE" });
  },
  get<TData>(path: string, init?: ApiRequestInit) {
    return apiRequest<TData>(path, { ...init, method: "GET" });
  },
  patch<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ) {
    return apiRequest<TData>(path, { ...init, body, method: "PATCH" });
  },
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ) {
    return apiRequest<TData>(path, { ...init, body, method: "POST" });
  },
};

export function createApiUrl(path: string, query?: ApiQuery): string {
  const base = API_BASE_PATH.endsWith("/")
    ? API_BASE_PATH.slice(0, -1)
    : API_BASE_PATH;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const isAbsolute = /^https?:\/\//u.test(base);
  const url = new URL(`${base}${suffix}`, isAbsolute ? undefined : "http://local");

  appendQuery(url.searchParams, query);

  return isAbsolute ? url.toString() : `${url.pathname}${url.search}`;
}

function appendQuery(searchParams: URLSearchParams, query?: ApiQuery) {
  if (!query) {
    return;
  }

  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => {
      searchParams.append(key, value);
    });
    return;
  }

  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        searchParams.append(key, String(item));
      });
      return;
    }

    searchParams.set(key, String(value));
  });
}

function createHeaders(
  headers: HeadersInit | undefined,
  body: ApiRequestInit["body"],
) {
  const result = new Headers(headers);

  if (shouldSerializeJson(body) && !result.has("Content-Type")) {
    result.set("Content-Type", "application/json");
  }

  if (!result.has("Accept")) {
    result.set("Accept", "application/json");
  }

  return result;
}

function serializeBody(body: ApiRequestInit["body"]) {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (shouldSerializeJson(body)) {
    return JSON.stringify(body);
  }

  return body;
}

function shouldSerializeJson(
  body: ApiRequestInit["body"],
): body is Record<string, unknown> | unknown[] {
  return (
    typeof body === "object" &&
    body !== null &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof Blob) &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams) &&
    !(body instanceof ReadableStream)
  );
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

function toApiError(payload: unknown, response: Response): ApiError {
  if (isApiError(payload)) {
    return payload;
  }

  return {
    code: fallbackErrorCode(response.status),
    message: response.statusText || "Request failed",
    requestId: response.headers.get("x-request-id") || "unknown",
  };
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

function fallbackErrorCode(status: number): ApiErrorCode {
  if (status === 401) {
    return "UNAUTHORIZED";
  }

  if (status === 403) {
    return "FORBIDDEN";
  }

  if (status === 404) {
    return "NOT_FOUND";
  }

  if (status === 409) {
    return "CONFLICT";
  }

  if (status === 429) {
    return "RATE_LIMITED";
  }

  if (status >= 500) {
    return "INTERNAL_SERVER_ERROR";
  }

  return "BAD_REQUEST";
}
