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
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  if (!cookieHeader.includes("=")) {
    throw new Error(
      "UI E2E: 浏览器上下文未携带任何会话 cookie，无法初始化空间。",
    );
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
  // The app may keep long-lived framework/runtime requests open, so waiting
  // for "networkidle" can hang even after the shell has rendered correctly.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("org-switcher-current-name")).toHaveText(
    orgName,
    { timeout: 10_000 },
  );

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

  return [10, (hash >>> 16) & 255, (hash >>> 8) & 255, hash & 255].join(".");
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
  options: {
    dueDate?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    versionId?: string;
    workflowVersionId?: string;
  } = {},
): Promise<{ id: string; title: string }> {
  const data = await postUiData<{ id?: string; title?: string }>(
    user,
    `/spaces/${user.spaceId}/work-items`,
    {
      dueDate: options.dueDate,
      priority: options.priority ?? "MEDIUM",
      title,
      type: "TASK",
      versionId: options.versionId,
      workflowVersionId: options.workflowVersionId,
    },
    "POST /spaces/:id/work-items",
  );

  if (!data.id) {
    throw new Error("UI E2E: 创建任务响应缺少 data.id。");
  }
  return { id: data.id, title: data.title ?? title };
}

export async function createBugForUi(
  user: UiTestUser,
  title: string,
  options: {
    dueDate?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    severity?: "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "TRIVIAL";
    versionId?: string;
  } = {},
): Promise<{ id: string; title: string }> {
  const data = await postUiData<{ id?: string; title?: string }>(
    user,
    `/spaces/${user.spaceId}/bugs`,
    {
      dueDate: options.dueDate,
      priority: options.priority ?? "HIGH",
      severity: options.severity ?? "MAJOR",
      stepsToReproduce: "UI E2E 预置缺陷复现步骤",
      title,
      versionId: options.versionId,
    },
    "POST /spaces/:id/bugs",
  );

  if (!data.id) {
    throw new Error("UI E2E: 创建 Bug 响应缺少 data.id。");
  }
  return { id: data.id, title: data.title ?? title };
}

export async function createIntakeForUi(
  user: UiTestUser,
  title: string,
  options: {
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    sourceType?:
      | "REQUIREMENT_CHANGE"
      | "DEFECT_PROBLEM"
      | "PROJECT_PLAN"
      | "MEETING_DECISION"
      | "AD_HOC";
    versionId?: string;
  } = {},
): Promise<{ id: string; title: string }> {
  const data = await postUiData<{ id?: string; title?: string }>(
    user,
    `/spaces/${user.spaceId}/intake-items`,
    {
      description: "UI E2E 预置需求池条目",
      priority: options.priority ?? "MEDIUM",
      sourceType: options.sourceType ?? "AD_HOC",
      title,
      versionId: options.versionId,
    },
    "POST /spaces/:id/intake-items",
  );

  if (!data.id) {
    throw new Error("UI E2E: 创建需求池条目响应缺少 data.id。");
  }
  return { id: data.id, title: data.title ?? title };
}

export async function acceptIntakeForUi(
  user: UiTestUser,
  intakeItemId: string,
): Promise<void> {
  await postUiData(
    user,
    `/intake-items/${intakeItemId}/accept`,
    {},
    "POST /intake-items/:id/accept",
  );
}

export async function createVersionForUi(
  user: UiTestUser,
  name: string,
): Promise<{ id: string; name: string }> {
  const data = await postUiData<{ id?: string; name?: string }>(
    user,
    `/spaces/${user.spaceId}/versions`,
    {
      name,
      status: "IN_PROGRESS",
      target: "UI E2E 全量页面覆盖",
    },
    "POST /spaces/:id/versions",
  );

  if (!data.id) {
    throw new Error("UI E2E: 创建版本响应缺少 data.id。");
  }
  return { id: data.id, name: data.name ?? name };
}

export async function createRequirementDraftForUi(
  user: UiTestUser,
  options: { versionId?: string } = {},
): Promise<{ id: string }> {
  const data = await postUiData<{ id?: string }>(
    user,
    `/spaces/${user.spaceId}/requirements`,
    {
      versionId: options.versionId,
    },
    "POST /spaces/:id/requirements",
  );

  if (!data.id) {
    throw new Error("UI E2E: 创建需求 DRAFT 响应缺少 data.id。");
  }
  return { id: data.id };
}

export async function listWorkflowDefinitionsForUi(
  user: UiTestUser,
): Promise<Array<{ id: string; code?: string; name?: string }>> {
  const data = await getUiData<{
    items?: Array<{ id: string; code?: string; name?: string }>;
  }>(
    user,
    `/spaces/${user.spaceId}/workflows?page=1&pageSize=100`,
    "GET /spaces/:id/workflows",
  );

  return data.items ?? [];
}

export async function ensureWorkflowDefinitionForUi(
  user: UiTestUser,
  runId: string,
): Promise<{ id: string; code?: string; name?: string }> {
  const existing = await listWorkflowDefinitionsForUi(user);
  if (existing.length > 0) {
    return existing[0]!;
  }

  const suffix = runId.replace(/[^a-zA-Z0-9]/gu, "").toUpperCase();
  const definition = await postUiData<{
    code?: string;
    id?: string;
    name?: string;
  }>(
    user,
    `/spaces/${user.spaceId}/workflows`,
    {
      code: `UI_TASK_${suffix}`.slice(0, 80),
      name: `UI Task Workflow ${runId}`,
    },
    "POST /spaces/:id/workflows",
  );
  if (!definition.id) {
    throw new Error("UI E2E: 创建流程定义响应缺少 data.id。");
  }

  const draft = await postUiData<{ id?: string }>(
    user,
    `/workflows/${definition.id}/versions`,
    {},
    "POST /workflows/:id/versions",
  );
  if (!draft.id) {
    throw new Error("UI E2E: 创建流程版本响应缺少 data.id。");
  }

  const start = await postUiData<{ id?: string }>(
    user,
    `/workflow-versions/${draft.id}/states`,
    {
      category: "NOT_STARTED",
      code: "TODO",
      isStart: true,
      name: "待处理",
      order: 0,
    },
    "POST /workflow-versions/:id/states",
  );
  if (!start.id) {
    throw new Error("UI E2E: 创建开始状态响应缺少 data.id。");
  }

  const done = await postUiData<{ id?: string }>(
    user,
    `/workflow-versions/${draft.id}/states`,
    {
      category: "DONE",
      code: "DONE",
      isEnd: true,
      name: "已完成",
      order: 1,
    },
    "POST /workflow-versions/:id/states",
  );
  if (!done.id) {
    throw new Error("UI E2E: 创建完成状态响应缺少 data.id。");
  }

  await postUiData(
    user,
    `/workflow-versions/${draft.id}/actions`,
    {
      allowedSpaceRoles: ["SPACE_ADMIN", "PM"],
      code: "COMPLETE",
      fromStateId: start.id,
      name: "完成",
      order: 0,
      requiresComment: false,
      toStateId: done.id,
    },
    "POST /workflow-versions/:id/actions",
  );

  const version = await postUiData<{ id?: string }>(
    user,
    `/workflow-versions/${draft.id}/publish`,
    {},
    "POST /workflow-versions/:id/publish",
  );
  if (!version.id) {
    throw new Error("UI E2E: 发布流程版本响应缺少 data.id。");
  }

  await postUiData(
    user,
    `/spaces/${user.spaceId}/workflow-bindings`,
    {
      isDefault: true,
      workflowVersionId: version.id,
      workItemType: "TASK",
    },
    "POST /spaces/:id/workflow-bindings",
  );

  const workflow: { id: string; code?: string; name?: string } = {
    id: definition.id,
  };
  if (definition.code) workflow.code = definition.code;
  if (definition.name) workflow.name = definition.name;
  return workflow;
}

async function getUiData<TData>(
  user: UiTestUser,
  path: string,
  label: string,
): Promise<TData> {
  const response = await user.context.get(apiPath(path), {
    headers: uiAuthHeaders(user),
  });
  return readUiDataResponse<TData>(response, label);
}

async function postUiData<TData = unknown>(
  user: UiTestUser,
  path: string,
  data: unknown,
  label: string,
): Promise<TData> {
  const response = await user.context.post(apiPath(path), {
    data,
    headers: uiAuthHeaders(user),
  });
  return readUiDataResponse<TData>(response, label);
}

async function readUiDataResponse<TData>(
  response: {
    json: () => Promise<unknown>;
    ok: () => boolean;
    status: () => number;
    text: () => Promise<string>;
  },
  label: string,
): Promise<TData> {
  if (!response.ok()) {
    throw new Error(
      `UI E2E: ${label} 返回 ${response.status()}：${await response.text()}`,
    );
  }
  const body = (await response.json()) as { data?: TData };
  if (body.data === undefined) {
    throw new Error(`UI E2E: ${label} 响应缺少 data。`);
  }
  return body.data;
}

function uiAuthHeaders(user: UiTestUser): Record<string, string> {
  return {
    ...unsafeRequestHeaders(),
    ...authenticatedRequestHeaders(user.cookie),
  };
}
