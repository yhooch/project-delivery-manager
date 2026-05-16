import { expect, test, type APIResponse } from "@playwright/test";
import type { z } from "zod";

import {
  apiResponseSchema,
  CreateSpaceResponseSchema,
  GetAuthSessionResponseSchema,
  GetMyWorkbenchViewResponseSchema,
  GetSpaceExceptionsViewResponseSchema,
  GetSpaceOverviewViewResponseSchema,
  GetVersionBoardViewResponseSchema,
  UpdateSpaceResponseSchema,
  UpdateUserPreferencesResponseSchema,
  type Space,
} from "../../packages/shared/src/index";
import {
  addOrganizationMember,
  addSpaceMember,
  createBug,
  createOrganization,
  createTask,
  createVersion,
  defaultWorkflowVersion,
  executeAction,
  expectRejected,
  findAction,
  get,
  getBug,
  getWorkItem,
  patch,
  post,
  registerAndLoginUser,
  type M3User,
} from "./support/m3-env";
import {
  buildM4RunId,
  skipWhenM4EnvironmentUnavailable,
} from "./support/m4-env";

type ApiSchema<T> = z.ZodType<T>;

test.describe.configure({ mode: "serial" });

test.describe("M4-J MVP 自动化主链路与回归用例", () => {
  const runId = buildM4RunId();
  const password = `M4-e2e-${runId}-Pass1`;
  const users: M3User[] = [];

  test.afterAll(async () => {
    await Promise.all(users.map((user) => user.context.dispose()));
  });

  test("覆盖工作台、流程待办、版本看板、异常视图、阈值、偏好和租户隔离", async () => {
    await skipWhenM4EnvironmentUnavailable();

    const owner = await registerUser("owner");
    const pm = await registerUser("pm");
    const developer = await registerUser("dev");
    const tester = await registerUser("tester");
    const outsider = await registerUser("outside");

    const organization = await createOrganization(owner, runId);
    const otherOrganization = await createOrganization(owner, `${runId}b`);
    const outsiderOrganization = await createOrganization(
      outsider,
      `${runId}x`,
    );
    const space = await createSpaceWithThreshold(
      owner,
      organization.id,
      runId,
      "main",
      2,
    );
    const otherSpace = await createSpaceWithThreshold(
      owner,
      otherOrganization.id,
      runId,
      "other",
      2,
    );
    const thresholdSpace = await updateSpaceThreshold(owner, space.id, 1);

    expect(thresholdSpace.settings.staleThresholdDays).toBe(1);

    for (const user of [pm, developer, tester]) {
      await addOrganizationMember(owner, organization.id, user.username);
    }

    await addSpaceMember(owner, space.id, pm.id, "PM");
    await addSpaceMember(owner, space.id, developer.id, "DEVELOPER");
    await addSpaceMember(owner, space.id, tester.id, "TESTER");

    const version = await createVersion(pm, space.id, runId);
    const otherVersion = await createVersion(owner, otherSpace.id, `${runId}b`);
    const developmentWorkflow = await defaultWorkflowVersion(
      pm,
      space.id,
      "DEVELOPMENT_TASK",
    );
    const generalWorkflow = await defaultWorkflowVersion(
      pm,
      space.id,
      "GENERAL_TASK",
    );

    const blockedTask = await createDevelopmentTask({
      assignee: developer,
      pm,
      runId: `${runId}_blocked`,
      spaceId: space.id,
      versionId: version.id,
      workflowVersionId: developmentWorkflow.id,
    });
    const readyForTestTask = await createDevelopmentTask({
      assignee: developer,
      pm,
      runId: `${runId}_ready`,
      spaceId: space.id,
      versionId: version.id,
      workflowVersionId: developmentWorkflow.id,
    });
    const testingTask = await createDevelopmentTask({
      assignee: developer,
      pm,
      runId: `${runId}_testing`,
      spaceId: space.id,
      versionId: version.id,
      workflowVersionId: developmentWorkflow.id,
    });
    const pendingConfirmTask = await createGeneralTaskWaitingForConfirmation({
      assignee: developer,
      pm,
      runId: `${runId}_confirm`,
      spaceId: space.id,
      versionId: version.id,
      workflowVersionId: generalWorkflow.id,
    });
    await createTask(owner, otherSpace.id, {
      assigneeId: owner.id,
      runId: `${runId}_tenant_b`,
      versionId: otherVersion.id,
    });

    let currentBlockedTask = await getWorkItem(developer, blockedTask.id);
    currentBlockedTask = await executeAction(
      developer,
      blockedTask.id,
      findAction(currentBlockedTask, "START_PROGRESS"),
    );
    currentBlockedTask = await executeAction(
      developer,
      blockedTask.id,
      findAction(currentBlockedTask, "MARK_BLOCKED"),
      {
        formValues: {
          blockedReason: "等待集成环境",
        },
      },
    );
    expect(currentBlockedTask.statusCategory).toBe("WAITING");
    expect(currentBlockedTask.blockedReason).toBe("等待集成环境");

    let currentReadyForTestTask = await getWorkItem(
      developer,
      readyForTestTask.id,
    );
    currentReadyForTestTask = await executeAction(
      developer,
      readyForTestTask.id,
      findAction(currentReadyForTestTask, "START_PROGRESS"),
    );
    currentReadyForTestTask = await executeAction(
      developer,
      readyForTestTask.id,
      findAction(currentReadyForTestTask, "SUBMIT_TEST"),
      {
        formValues: {
          testNote: "WAITING 非阻塞验证",
        },
      },
    );
    expect(currentReadyForTestTask.statusCategory).toBe("WAITING");
    expect(currentReadyForTestTask.blockedReason).toBeUndefined();

    let currentTestingTask = await getWorkItem(developer, testingTask.id);
    currentTestingTask = await executeAction(
      developer,
      testingTask.id,
      findAction(currentTestingTask, "START_PROGRESS"),
    );
    await executeAction(
      developer,
      testingTask.id,
      findAction(currentTestingTask, "SUBMIT_TEST"),
      {
        formValues: {
          testNote: "VERIFYING 非待确认/非待回归验证",
        },
      },
    );
    currentTestingTask = await executeAction(
      tester,
      testingTask.id,
      findAction(await getWorkItem(tester, testingTask.id), "START_TEST"),
    );
    expect(currentTestingTask.statusCategory).toBe("VERIFYING");
    expect(currentTestingTask.currentStateId).not.toBe(
      pendingConfirmTask.currentStateId,
    );

    const regressionBug = await createBug(tester, space.id, {
      relatedTaskId: testingTask.id,
      runId,
      versionId: version.id,
    });
    let currentBug = await getBug(tester, regressionBug.id);
    await executeAction(
      tester,
      currentBug.id,
      findAction(currentBug, "CONFIRM_DEFECT"),
      {
        formValues: {
          fixAssigneeId: developer.id,
        },
      },
    );
    await executeAction(
      developer,
      currentBug.id,
      findAction(await getBug(developer, currentBug.id), "START_FIX"),
    );
    await executeAction(
      developer,
      currentBug.id,
      findAction(await getBug(developer, currentBug.id), "SUBMIT_REGRESSION"),
      {
        formValues: {
          fixSummary: "提交回归用于 M4-J 异常视图",
        },
      },
    );
    currentBug = await getBug(tester, currentBug.id);
    expect(currentBug.statusCategory).toBe("VERIFYING");

    const developerWorkbench = await expectData(
      await get(
        developer,
        `/views/my-workbench?organizationId=${organization.id}&spaceId=${space.id}&versionId=${version.id}&pageSize=50`,
      ),
      GetMyWorkbenchViewResponseSchema,
      "GET /views/my-workbench",
    );
    expect(developerWorkbench.filters).toMatchObject({
      organizationId: organization.id,
      spaceId: space.id,
      versionId: version.id,
    });
    expect(
      developerWorkbench.sections.assignedTasks.items.items.map(
        (item) => item.id,
      ),
    ).toEqual(expect.arrayContaining([blockedTask.id, readyForTestTask.id]));
    expect(
      developerWorkbench.sections.actionTodos.items.items.map(
        (todo) => todo.availableAction.code,
      ),
    ).toContain("RESOLVE_BLOCKED");
    expect(
      developerWorkbench.sections.actionTodos.items.items.every((todo) =>
        todo.actionTarget.executePath.includes(todo.workItem.id),
      ),
    ).toBe(true);

    const testerWorkbench = await expectData(
      await get(
        tester,
        `/views/my-workbench?organizationId=${organization.id}&spaceId=${space.id}&versionId=${version.id}&pageSize=50`,
      ),
      GetMyWorkbenchViewResponseSchema,
      "GET /views/my-workbench for tester",
    );
    expect(
      testerWorkbench.sections.actionTodos.items.items.map(
        (todo) => todo.availableAction.code,
      ),
    ).toEqual(expect.arrayContaining(["PASS_TEST", "REGRESSION_PASS"]));

    const board = await expectData(
      await get(
        pm,
        `/views/versions/${version.id}/board?organizationId=${organization.id}&spaceId=${space.id}&pageSize=50`,
      ),
      GetVersionBoardViewResponseSchema,
      "GET /views/versions/:versionId/board",
    );
    expect(board.filters).toMatchObject({
      organizationId: organization.id,
      spaceId: space.id,
      versionId: version.id,
    });
    expect(board.columns.map((column) => column.statusCategory)).toEqual(
      expect.arrayContaining(["WAITING", "VERIFYING"]),
    );
    const boardItems = board.columns.flatMap((column) => column.items.items);
    expect(boardItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        blockedTask.id,
        readyForTestTask.id,
        testingTask.id,
        pendingConfirmTask.id,
        regressionBug.id,
      ]),
    );
    expect(
      boardItems.every((item) => item.organizationId === organization.id),
    ).toBe(true);

    const overview = await expectData(
      await get(
        pm,
        `/views/spaces/${space.id}/overview?organizationId=${organization.id}&versionId=${version.id}`,
      ),
      GetSpaceOverviewViewResponseSchema,
      "GET /views/spaces/:spaceId/overview",
    );
    expect(overview.staleThresholdDays).toBe(1);
    expect(overview.stats.blockedCount).toBeGreaterThanOrEqual(1);
    expect(
      findExceptionCount(overview.exceptionCounts, "blocked"),
    ).toBeGreaterThanOrEqual(1);
    expect(
      findExceptionCount(overview.exceptionCounts, "pending_confirm"),
    ).toBeGreaterThanOrEqual(1);
    expect(
      findExceptionCount(overview.exceptionCounts, "pending_regression"),
    ).toBeGreaterThanOrEqual(1);

    const exceptions = await expectData(
      await get(
        pm,
        `/views/spaces/${space.id}/exceptions?organizationId=${organization.id}&versionId=${version.id}&pageSize=50`,
      ),
      GetSpaceExceptionsViewResponseSchema,
      "GET /views/spaces/:spaceId/exceptions",
    );
    const exceptionIds = exceptions.items.items.map((item) => item.workItem.id);
    expect(exceptionIds).toEqual(
      expect.arrayContaining([
        blockedTask.id,
        pendingConfirmTask.id,
        regressionBug.id,
      ]),
    );
    expect(exceptionIds).not.toContain(readyForTestTask.id);
    expect(exceptionIds).not.toContain(testingTask.id);
    expect(exceptionFor(exceptions, blockedTask.id)).toContain("blocked");
    expect(exceptionFor(exceptions, pendingConfirmTask.id)).toContain(
      "pending_confirm",
    );
    expect(exceptionFor(exceptions, regressionBug.id)).toContain(
      "pending_regression",
    );

    const blockedExceptions = await expectData(
      await get(
        pm,
        `/views/spaces/${space.id}/exceptions?organizationId=${organization.id}&versionId=${version.id}&exceptionType=blocked&pageSize=50`,
      ),
      GetSpaceExceptionsViewResponseSchema,
      "GET /views/spaces/:spaceId/exceptions?exceptionType=blocked",
    );
    expect(
      blockedExceptions.items.items.map((item) => item.workItem.id),
    ).toContain(blockedTask.id);
    expect(
      blockedExceptions.items.items.every((item) =>
        item.exceptions.some((signal) => signal.type === "blocked"),
      ),
    ).toBe(true);

    await expectRejected(
      await get(
        pm,
        `/views/spaces/${space.id}/overview?organizationId=${otherOrganization.id}`,
      ),
      "组织上下文与空间不一致时访问空间总览",
      [403],
    );
    await expectRejected(
      await get(
        outsider,
        `/views/my-workbench?organizationId=${organization.id}`,
      ),
      "跨租户访问我的工作台",
      [403],
    );
    expect(outsiderOrganization.id).not.toBe(organization.id);

    const switchedToOther = await expectData(
      await get(
        owner,
        `/auth/session?recentOrganizationId=${otherOrganization.id}&recentSpaceId=${otherSpace.id}`,
      ),
      GetAuthSessionResponseSchema,
      "GET /auth/session with recent organization and space",
    );
    expect(switchedToOther.defaultOrganizationId).toBe(otherOrganization.id);
    expect(switchedToOther.defaultSpaceId).toBe(otherSpace.id);

    const englishDark = await expectData(
      await patch(owner, "/users/me/preferences", {
        locale: "en-US",
        themeMode: "DARK",
      }),
      UpdateUserPreferencesResponseSchema,
      "PATCH /users/me/preferences en-US DARK",
    );
    expect(englishDark).toEqual({ locale: "en-US", themeMode: "DARK" });
    expect(
      (
        await expectData(
          await get(
            owner,
            `/auth/session?recentOrganizationId=${organization.id}`,
          ),
          GetAuthSessionResponseSchema,
          "GET /auth/session after en-US DARK",
        )
      ).user.preferences,
    ).toEqual(englishDark);

    const chineseLight = await expectData(
      await patch(owner, "/users/me/preferences", {
        locale: "zh-CN",
        themeMode: "LIGHT",
      }),
      UpdateUserPreferencesResponseSchema,
      "PATCH /users/me/preferences zh-CN LIGHT",
    );
    expect(chineseLight).toEqual({ locale: "zh-CN", themeMode: "LIGHT" });
  });

  async function registerUser(suffix: string): Promise<M3User> {
    const user = await registerAndLoginUser(
      `${runId}_${suffix}`.slice(0, 32),
      password,
    );

    users.push(user);

    return user;
  }
});

async function createSpaceWithThreshold(
  actor: M3User,
  organizationId: string,
  runId: string,
  suffix: string,
  staleThresholdDays: number,
): Promise<Space> {
  return expectData(
    await post(actor, `/organizations/${organizationId}/spaces`, {
      code: `${runId}_${suffix}`.slice(0, 32),
      name: `M4 ${suffix} ${runId}`,
      staleThresholdDays,
    }),
    CreateSpaceResponseSchema,
    "POST /organizations/:organizationId/spaces",
  );
}

async function updateSpaceThreshold(
  actor: M3User,
  spaceId: string,
  staleThresholdDays: number,
): Promise<Space> {
  return expectData(
    await patch(actor, `/spaces/${spaceId}`, {
      staleThresholdDays,
    }),
    UpdateSpaceResponseSchema,
    "PATCH /spaces/:spaceId",
  );
}

async function createDevelopmentTask(input: {
  assignee: M3User;
  pm: M3User;
  runId: string;
  spaceId: string;
  versionId: string;
  workflowVersionId: string;
}) {
  return createTask(input.pm, input.spaceId, {
    assigneeId: input.assignee.id,
    runId: input.runId,
    versionId: input.versionId,
    workflowVersionId: input.workflowVersionId,
  });
}

async function createGeneralTaskWaitingForConfirmation(input: {
  assignee: M3User;
  pm: M3User;
  runId: string;
  spaceId: string;
  versionId: string;
  workflowVersionId: string;
}) {
  const task = await createTask(input.pm, input.spaceId, {
    assigneeId: input.assignee.id,
    runId: input.runId,
    versionId: input.versionId,
    workflowVersionId: input.workflowVersionId,
  });
  let detail = await getWorkItem(input.assignee, task.id);
  detail = await executeAction(
    input.assignee,
    task.id,
    findAction(detail, "START_PROGRESS"),
  );

  return executeAction(
    input.assignee,
    task.id,
    findAction(detail, "SUBMIT_CONFIRMATION"),
    {
      formValues: {
        completionNote: "提交确认用于 M4-J 异常视图",
      },
    },
  );
}

async function expectData<T>(
  response: APIResponse,
  schema: ApiSchema<T>,
  label: string,
): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${label} 返回 HTTP ${response.status()}：${await response.text()}`,
    );
  }

  return apiResponseSchema(schema).parse(await response.json()).data;
}

function findExceptionCount(
  counts: Array<{ count: number; exceptionType: string }> | undefined,
  exceptionType: string,
): number {
  return (
    counts?.find((item) => item.exceptionType === exceptionType)?.count ?? 0
  );
}

function exceptionFor(
  exceptions: z.infer<typeof GetSpaceExceptionsViewResponseSchema>,
  workItemId: string,
): string[] {
  return (
    exceptions.items.items
      .find((item) => item.workItem.id === workItemId)
      ?.exceptions.map((signal) => signal.type) ?? []
  );
}
