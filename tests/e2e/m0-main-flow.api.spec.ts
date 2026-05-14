import {
  expect,
  request,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  apiResponseSchema,
  CreateOrganizationResponseSchema,
  GetAuthSessionResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  RegisterResponseSchema,
  UpdateUserPreferencesResponseSchema,
} from "../../packages/shared/src/index";
import {
  authenticatedRequestHeaders,
  apiPath,
  buildRunId,
  cookieHeaderFromSetCookieHeaders,
  e2eEnv,
  isProtectedResourceRejected,
  missingStaticPrerequisite,
  probeApi,
  probeWeb,
  unsafeAuthenticatedRequestHeaders,
  unsafeRequestHeaders,
} from "./support/m0-env";

test.describe.configure({ mode: "serial" });

test.describe("M0 主链路 E2E 骨架", () => {
  const runId = buildRunId();
  const credentials = {
    password: `M0-e2e-${runId}-Pass1`,
    username: `m0_${runId}`.slice(0, 32),
  };
  const organization = {
    code: `m0_${runId}`.slice(0, 32),
    name: `M0 E2E ${runId}`,
  };

  let apiContext: APIRequestContext | undefined;
  let organizationId: string | undefined;
  let sessionCookieHeader: string | undefined;

  test.afterAll(async () => {
    await apiContext?.dispose();
  });

  test("注册新用户", async () => {
    await skipWhenEnvironmentUnavailable();

    const registrationContext = await request.newContext({
      baseURL: `${e2eEnv.apiBaseURL}/`,
    });

    try {
      const response = await registrationContext.post(
        apiPath("/auth/register"),
        {
          data: {
            username: credentials.username,
            password: credentials.password,
            confirmPassword: credentials.password,
          },
          headers: unsafeRequestHeaders(),
        },
      );

      await expectSuccessfulResponse(response, "POST /auth/register");

      const body = apiResponseSchema(RegisterResponseSchema).parse(
        await response.json(),
      );

      expect(body.data.user.username).toBe(credentials.username);
      expect(body.data.capabilities.canCreateOrganization).toBe(true);
    } finally {
      await registrationContext.dispose();
    }
  });

  test("登录并建立 session", async () => {
    await skipWhenEnvironmentUnavailable();

    apiContext = await request.newContext({
      baseURL: `${e2eEnv.apiBaseURL}/`,
    });

    const response = await apiContext.post(apiPath("/auth/login"), {
      data: {
        username: credentials.username,
        password: credentials.password,
      },
      headers: unsafeRequestHeaders(),
    });

    await expectSuccessfulResponse(response, "POST /auth/login");

    const body = apiResponseSchema(LoginResponseSchema).parse(
      await response.json(),
    );

    expect(body.data.user.username).toBe(credentials.username);
    sessionCookieHeader = cookieHeaderFromSetCookieHeaders(
      response
        .headersArray()
        .filter(({ name }) => name.toLowerCase() === "set-cookie")
        .map(({ value }) => value),
    );
  });

  test("读取当前 session", async () => {
    await skipWhenEnvironmentUnavailable();
    const context = requireAuthenticatedContext();

    const response = await context.get(apiPath("/auth/session"), {
      headers: authenticatedRequestHeaders(requireSessionCookieHeader()),
    });

    await expectSuccessfulResponse(response, "GET /auth/session");

    const body = apiResponseSchema(GetAuthSessionResponseSchema).parse(
      await response.json(),
    );

    expect(body.data.user.username).toBe(credentials.username);
  });

  test("创建组织", async () => {
    await skipWhenEnvironmentUnavailable();
    const context = requireAuthenticatedContext();

    const response = await context.post(apiPath("/organizations"), {
      data: organization,
      headers: unsafeAuthenticatedRequestHeaders(requireSessionCookieHeader()),
    });

    await expectSuccessfulResponse(response, "POST /organizations");

    const body = apiResponseSchema(CreateOrganizationResponseSchema).parse(
      await response.json(),
    );

    expect(body.data.name).toBe(organization.name);
    expect(body.data.code).toBe(organization.code);

    organizationId = body.data.id;
  });

  test("更新用户偏好", async () => {
    await skipWhenEnvironmentUnavailable();
    const context = requireAuthenticatedContext();

    const response = await context.patch(apiPath("/users/me/preferences"), {
      data: {
        locale: "en-US",
        themeMode: "DARK",
      },
      headers: unsafeAuthenticatedRequestHeaders(requireSessionCookieHeader()),
    });

    await expectSuccessfulResponse(response, "PATCH /users/me/preferences");

    const body = apiResponseSchema(UpdateUserPreferencesResponseSchema).parse(
      await response.json(),
    );

    expect(body.data).toEqual({
      locale: "en-US",
      themeMode: "DARK",
    });
  });

  test("登出当前 session", async () => {
    await skipWhenEnvironmentUnavailable();
    const context = requireAuthenticatedContext();

    expect(organizationId, "组织创建步骤应在登出前完成").toBeDefined();

    const response = await context.post(apiPath("/auth/logout"), {
      data: {},
      headers: unsafeAuthenticatedRequestHeaders(requireSessionCookieHeader()),
    });

    await expectSuccessfulResponse(response, "POST /auth/logout");

    apiResponseSchema(LogoutResponseSchema).parse(await response.json());
  });

  test("登出后受保护接口拒绝访问", async () => {
    await skipWhenEnvironmentUnavailable();
    const context = requireAuthenticatedContext();

    const response = await context.get(apiPath("/auth/session"), {
      headers: authenticatedRequestHeaders(requireSessionCookieHeader()),
    });

    expect(
      isProtectedResourceRejected(response),
      `GET /auth/session 应返回 401/403，实际为 ${response.status()}`,
    ).toBe(true);
  });

  function requireAuthenticatedContext(): APIRequestContext {
    test.skip(!apiContext, "登录步骤未建立 API session，跳过后续主链路步骤。");

    return apiContext;
  }

  function requireSessionCookieHeader(): string {
    test.skip(
      !sessionCookieHeader,
      "登录响应未建立 session cookie，跳过后续主链路步骤。",
    );

    return sessionCookieHeader;
  }
});

let environmentSkipReason: Promise<string | undefined> | undefined;

async function skipWhenEnvironmentUnavailable(): Promise<void> {
  environmentSkipReason ??= resolveEnvironmentSkipReason();

  const reason = await environmentSkipReason;
  test.skip(Boolean(reason), reason);
}

async function resolveEnvironmentSkipReason(): Promise<string | undefined> {
  const staticReason = missingStaticPrerequisite();
  if (staticReason) {
    return staticReason;
  }

  const apiProbe = await probeApi();
  if (!apiProbe.ok) {
    return apiProbe.reason;
  }

  if (e2eEnv.requireWeb) {
    const webProbe = await probeWeb();
    if (!webProbe.ok) {
      return webProbe.reason;
    }
  }

  return undefined;
}

async function expectSuccessfulResponse(
  response: {
    ok: () => boolean;
    status: () => number;
    text: () => Promise<string>;
  },
  label: string,
): Promise<void> {
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`${label} 返回 HTTP ${response.status()}：${body}`);
  }
}
