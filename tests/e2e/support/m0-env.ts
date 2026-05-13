const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

type ResponseStatus = {
  status: () => number;
};

export const e2eEnv = {
  apiBaseURL: normalizeBaseURL(
    process.env.E2E_API_URL ?? "http://127.0.0.1:3001/api/v1",
  ),
  dbReady: readBoolean(process.env.E2E_DB_READY),
  enabled: readBoolean(process.env.E2E_M0_ENABLED),
  requestTimeoutMs: readPositiveInteger(
    process.env.E2E_REQUEST_TIMEOUT_MS,
    5_000,
  ),
  requireWeb: readBoolean(process.env.E2E_REQUIRE_WEB),
  webBaseURL: normalizeBaseURL(
    process.env.E2E_WEB_URL ?? "http://127.0.0.1:3000",
  ),
};

export type ProbeResult = {
  ok: boolean;
  reason?: string;
};

export function authenticatedRequestHeaders(
  cookieHeader: string,
): Record<string, string> {
  return {
    Cookie: cookieHeader,
  };
}

export function cookieHeaderFromSetCookieHeaders(
  setCookieHeaders: readonly string[],
): string {
  for (const setCookieHeader of setCookieHeaders) {
    const [cookiePair] = setCookieHeader.split(";");
    const cookie = cookiePair?.trim();

    if (cookie?.includes("=")) {
      return cookie;
    }
  }

  throw new Error("登录响应缺少 Set-Cookie header，无法建立 E2E session。");
}

export function unsafeRequestHeaders(): Record<string, string> {
  const origin = new URL(e2eEnv.webBaseURL).origin;

  return {
    Origin: origin,
    Referer: `${origin}/`,
  };
}

export function unsafeAuthenticatedRequestHeaders(
  cookieHeader: string,
): Record<string, string> {
  return {
    ...unsafeRequestHeaders(),
    ...authenticatedRequestHeaders(cookieHeader),
  };
}

export function apiPath(path: string): string {
  return path.replace(/^\/+/u, "");
}

export function apiURL(path: string): string {
  return new URL(apiPath(path), `${e2eEnv.apiBaseURL}/`).toString();
}

export function buildRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function missingStaticPrerequisite(): string | undefined {
  if (!e2eEnv.enabled) {
    return "M0 E2E 默认跳过；设置 E2E_M0_ENABLED=1 后才会执行注册/登录等主链路。";
  }

  if (!e2eEnv.dbReady) {
    return "M0 E2E 需要已迁移的可丢弃测试数据库；确认 API 使用测试库后设置 E2E_DB_READY=1。";
  }

  return undefined;
}

export function isEndpointMissing(response: ResponseStatus): boolean {
  return response.status() === 404 || response.status() === 501;
}

export function isProtectedResourceRejected(response: ResponseStatus): boolean {
  return response.status() === 401 || response.status() === 403;
}

export async function probeApi(): Promise<ProbeResult> {
  return probeURL(apiURL("/health"), "API health");
}

export async function probeWeb(): Promise<ProbeResult> {
  return probeURL(e2eEnv.webBaseURL, "Web app");
}

async function probeURL(url: string, label: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), e2eEnv.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      reason: `${label} ${url} 返回 HTTP ${response.status}，跳过 M0 E2E。`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      reason: `${label} ${url} 不可访问：${message}。跳过 M0 E2E。`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseURL(value: string): string {
  return value.replace(/\/+$/u, "");
}

function readBoolean(value: string | undefined): boolean {
  return TRUE_VALUES.has(value?.toLowerCase() ?? "");
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
