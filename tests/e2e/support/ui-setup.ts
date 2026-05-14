import {
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  apiPath,
  authenticatedRequestHeaders,
  e2eEnv,
  unsafeRequestHeaders,
} from "./m0-env";

/**
 * Holds the freshly provisioned tenant assets so individual specs can
 * reference the resulting org/space if they need to drive the API directly.
 */
export type UiTestUser = {
  cookie: string;
  context: APIRequestContext;
  password: string;
  userId: string;
  username: string;
  organizationId: string;
  organizationName: string;
  spaceId: string;
  spaceName: string;
};

export type UiSetupOptions = {
  page: Page;
  runId: string;
};

/**
 * End-to-end setup that:
 *   1. Registers a fresh user through the UI.
 *   2. Creates the user's first organization through the onboarding dialog.
 *   3. Provisions a space against that org via the REST API (the shell does
 *      not currently expose space creation in the UI shell, so we side-load
 *      it through the API and refresh the session by reloading the page).
 *
 * Returns the cookie/context handles in case a spec needs to seed extra
 * records (tasks, requirements, bugs, …) before exercising UI flows.
 */
export async function registerLoginCreateOrgAndSpace({
  page,
  runId,
}: UiSetupOptions): Promise<UiTestUser> {
  const username = `ui_${runId}`;
  const password = `Aa_${runId}!1`;
  const orgName = `Org ${runId}`;
  const orgCode = `o${runId}`.slice(0, 32);
  const spaceName = `Space ${runId}`;
  const spaceCode = `s${runId}`.slice(0, 32);
  const forwardedFor = buildUiForwardedFor(runId);

  // 1) Register via the UI -------------------------------------------------
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": forwardedFor,
  });
  await page.goto(`${e2eEnv.webBaseURL}/zh-CN/register`);
  await page.fill("#register-username", username);
  await page.fill("#register-password", password);
  await page.fill("#register-confirm-password", password);
  await page.getByTestId("register-submit").click();

  // After registration the user lands on the onboarding empty state because
  // they have no organizations yet.
  await expect(page.getByTestId("onboarding-empty")).toBeVisible({
    timeout: 10_000,
  });

  // 2) Create the first organization via the onboarding dialog ------------
  await page.getByTestId("onboarding-create-org-button").click();
  await expect(page.getByTestId("create-org-dialog")).toBeVisible();
  await page.getByTestId("create-org-name-input").fill(orgName);
  await page.getByTestId("create-org-code-input").fill(orgCode);
  await page.getByTestId("create-org-submit").click();
  await expect(page.getByTestId("create-org-dialog")).toBeHidden({
    timeout: 10_000,
  });

  // The session refresh fires asynchronously; wait for the switcher to show
  // the freshly created org.
  await expect(page.getByTestId("org-switcher-current-name")).toHaveText(
    orgName,
    { timeout: 10_000 },
  );

  // 3) Pull cookie back out of the browser context so we can drive the API.
  const cookies = await page.context().cookies();
  const cookieHeader = cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  if (!cookieHeader.includes("=")) {
    throw new Error("UI E2E: 浏览器上下文未携带任何会话 cookie，无法初始化空间。");
  }

  const apiContext = await request.newContext({
    baseURL: `${e2eEnv.apiBaseURL}/`,
  });

  const meResponse = await apiContext.get(apiPath("/auth/session"), {
    headers: authenticatedRequestHeaders(cookieHeader),
  });
  if (!meResponse.ok()) {
    throw new Error(
      `UI E2E: /auth/session 返回 ${meResponse.status()}，无法读取当前用户信息。`,
    );
  }
  const meBody = (await meResponse.json()) as {
    data?: {
      user?: { id?: string };
      organizations?: ReadonlyArray<{ id: string; name: string }>;
    };
  };
  const meUserId = meBody?.data?.user?.id;
  if (!meUserId) {
    throw new Error("UI E2E: /auth/session 响应缺少 user.id。");
  }
  const orgFromSession = meBody?.data?.organizations?.find(
    (o) => o.name === orgName,
  );
  if (!orgFromSession) {
    throw new Error(
      "UI E2E: 创建组织成功，但 /auth/session 未返回同名组织，疑似会话同步异常。",
    );
  }
  const organizationId = orgFromSession.id;

  // 4) Create a space via the API ----------------------------------------
  const spaceResponse = await apiContext.post(
    apiPath(`/organizations/${organizationId}/spaces`),
    {
      data: { name: spaceName, code: spaceCode },
      headers: {
        ...unsafeRequestHeaders(),
        ...authenticatedRequestHeaders(cookieHeader),
      },
    },
  );
  if (!spaceResponse.ok()) {
    throw new Error(
      `UI E2E: POST /organizations/:id/spaces 返回 ${spaceResponse.status()}，无法创建空间。`,
    );
  }
  const spaceBody = (await spaceResponse.json()) as {
    data?: { id?: string };
  };
  const spaceId = spaceBody?.data?.id;
  if (!spaceId) {
    throw new Error("UI E2E: 创建空间响应缺少 data.id。");
  }

  // 5) Refresh the page so the session picks up the freshly minted space.
  await page.reload();

  return {
    cookie: cookieHeader,
    context: apiContext,
    password,
    userId: meUserId,
    username,
    organizationId,
    organizationName: orgName,
    spaceId,
    spaceName,
  };
}

/**
 * Fire-and-forget cleanup. The current API does not expose teardown
 * endpoints suitable for E2E, so we only dispose the request context — the
 * test database is expected to be a disposable instance.
 */
export async function disposeUiUser(user: UiTestUser): Promise<void> {
  await user.context.dispose();
}

/**
 * Re-uses the existing UI run id formatter while keeping it short enough
 * that the API does not reject the derived org / space codes (max 32 chars).
 */
export function shortRunId(): string {
  const random = Math.random().toString(36).slice(2, 6);
  return `ui${Date.now().toString(36)}${random}`.slice(0, 24);
}

function buildUiForwardedFor(runId: string): string {
  let hash = 0;
  for (const char of runId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return [
    10,
    (hash >>> 16) & 255,
    (hash >>> 8) & 255,
    hash & 255,
  ].join(".");
}

/**
 * Helper: open the command palette via the standard ⌘K / Ctrl+K shortcut.
 * Some browsers swallow `Meta` events, so we double-tap by pressing
 * `Control+KeyK` as a fallback if the input does not appear quickly.
 */
export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press("Meta+KeyK");
  try {
    await page.getByTestId("command-palette-input").waitFor({ timeout: 1_500 });
    return;
  } catch {
    // fall through and try the trigger button
  }
  await page.getByTestId("command-palette-trigger").click();
  await page.getByTestId("command-palette-input").waitFor({ timeout: 5_000 });
}

/**
 * Creates a real Task via the API so the UI flows that need at least one
 * task to interact with can be driven deterministically. We deliberately
 * skip workflow-version juggling — the API endpoint accepts a bare task
 * payload and falls back to defaults.
 */
export async function createTaskForUi(
  user: UiTestUser,
  title: string,
): Promise<{ id: string; title: string }> {
  const response = await user.context.post(
    apiPath(`/spaces/${user.spaceId}/work-items`),
    {
      data: {
        title,
        type: "TASK",
        priority: "MEDIUM",
      },
      headers: {
        ...unsafeRequestHeaders(),
        ...authenticatedRequestHeaders(user.cookie),
      },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `UI E2E: POST /spaces/:id/work-items 返回 ${response.status()}，无法预置任务。`,
    );
  }
  const body = (await response.json()) as {
    data?: { id?: string; title?: string };
  };
  if (!body?.data?.id) {
    throw new Error("UI E2E: 创建任务响应缺少 data.id。");
  }
  return { id: body.data.id, title: body.data.title ?? title };
}
