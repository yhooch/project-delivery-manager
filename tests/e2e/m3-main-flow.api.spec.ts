import { expect, test } from "@playwright/test";

import {
  AcceptIntakeItemResponseSchema,
  ConvertIntakeItemToWorkItemsResponseSchema,
  CreateAttachmentResponseSchema,
  CreateIntakeItemResponseSchema,
  CreateRequirementDraftResponseSchema,
  GetAttachmentDownloadUrlResponseSchema,
  GetRequirementResponseSchema,
  ListAttachmentsResponseSchema,
  ListWorkItemsResponseSchema,
  PresignAttachmentResponseSchema,
} from "../../packages/shared/src/index";

import {
  addOrganizationMember,
  addSpaceMember,
  buildM3RunId,
  createBug,
  createCommentRequiredWorkflow,
  createConfirmedRequirement,
  createOrganization,
  createSpace,
  createTask,
  createVersion,
  defaultWorkflowVersion,
  executeAction,
  expectRejected,
  expectData,
  findAction,
  findAuditLogs,
  get,
  getBug,
  getPrismaClient,
  getWorkItem,
  listWorkItemTimeline,
  patch,
  post,
  registerAndLoginUser,
  skipWhenM3EnvironmentUnavailable,
  updateTaskAssignee,
  type M3User,
} from "./support/m3-env";

test.describe.configure({ mode: "serial" });

test.describe("M3 自动化主链路与回归用例", () => {
  const runId = buildM3RunId();
  const password = `M3-e2e-${runId}-Pass1`;
  const users: M3User[] = [];

  test.afterAll(async () => {
    await Promise.all(users.map((user) => user.context.dispose()));
  });

  test("API 主链路覆盖流程动作、Bug、时间线、权限、隔离和审计", async () => {
    await skipWhenM3EnvironmentUnavailable();

    const owner = await registerUser("owner");
    const pm = await registerUser("pm");
    const developer = await registerUser("dev");
    const tester = await registerUser("tester");
    const viewer = await registerUser("viewer");
    const orgOnly = await registerUser("orgonly");
    const outsider = await registerUser("outside");

    const organization = await createOrganization(owner, runId);
    const space = await createSpace(owner, organization.id, runId, "main");
    const otherSpace = await createSpace(
      owner,
      organization.id,
      runId,
      "other",
    );
    const outsiderOrganization = await createOrganization(
      outsider,
      `${runId}x`,
    );

    for (const user of [pm, developer, tester, viewer, orgOnly]) {
      await addOrganizationMember(owner, organization.id, user.username);
    }

    await addSpaceMember(owner, space.id, pm.id, "PM");
    await addSpaceMember(owner, space.id, developer.id, "DEVELOPER");
    await addSpaceMember(owner, space.id, tester.id, "TESTER");
    await addSpaceMember(owner, space.id, viewer.id, "VIEWER");
    await addSpaceMember(owner, otherSpace.id, developer.id, "DEVELOPER");

    const version = await createVersion(pm, space.id, runId);
    const requirement = await createConfirmedRequirement(
      pm,
      space.id,
      version.id,
      runId,
    );
    const draftRequirement = await expectData(
      await post(pm, `/spaces/${space.id}/requirements`, {
        versionId: version.id,
      }),
      CreateRequirementDraftResponseSchema,
      "POST /spaces/:spaceId/requirements for attachment draft",
    );
    const developmentWorkflow = await defaultWorkflowVersion(
      pm,
      space.id,
      "DEVELOPMENT_TASK",
    );
    const bugWorkflow = await defaultWorkflowVersion(pm, space.id, "BUG");

    expect(developmentWorkflow.states.some((state) => state.isStart)).toBe(
      true,
    );
    expect(developmentWorkflow.actions.map((action) => action.code)).toEqual(
      expect.arrayContaining([
        "START_PROGRESS",
        "MARK_BLOCKED",
        "SUBMIT_TEST",
        "START_TEST",
        "PASS_TEST",
      ]),
    );
    expect(bugWorkflow.actions.map((action) => action.code)).toEqual(
      expect.arrayContaining([
        "CONFIRM_DEFECT",
        "START_FIX",
        "SUBMIT_REGRESSION",
        "REGRESSION_FAIL",
        "REGRESSION_PASS",
        "CLOSE_DEFECT",
        "REOPEN_DEFECT",
      ]),
    );

    await assertRequirementImageUploadChain(pm, draftRequirement.id);

    const task = await createTask(pm, space.id, {
      assigneeId: developer.id,
      requirementId: requirement.id,
      runId,
      versionId: version.id,
      workflowVersionId: developmentWorkflow.id,
    });
    const initialTaskDetail = await getWorkItem(developer, task.id);
    const startProgress = findAction(initialTaskDetail, "START_PROGRESS");

    const viewerTaskDetail = await getWorkItem(viewer, task.id);
    expect(viewerTaskDetail.permissions.availableActions).toHaveLength(0);
    await expectRejected(
      await post(
        viewer,
        `/work-items/${task.id}/actions/${startProgress.id}/execute`,
        {
          formValues: {},
        },
      ),
      "VIEWER 执行任务动作",
      [403],
    );

    let currentTask = await executeAction(developer, task.id, startProgress);
    expect(currentTask.statusCategory).toBe("IN_PROGRESS");
    await expectRejected(
      await post(
        developer,
        `/work-items/${task.id}/actions/${startProgress.id}/execute`,
        {
          formValues: {},
        },
      ),
      "当前状态不可用时重复执行动作",
      [409],
    );

    await expectRejected(
      await post(
        developer,
        `/work-items/${task.id}/actions/${findAction(currentTask, "SUBMIT_TEST").id}/execute`,
        {
          formValues: {},
        },
      ),
      "缺少必填表单字段",
      [400],
    );

    const markBlocked = findAction(currentTask, "MARK_BLOCKED");
    currentTask = await executeAction(developer, task.id, markBlocked, {
      formValues: {
        blockedReason: "等待外部环境",
      },
    });
    expect(currentTask.statusCategory).toBe("WAITING");
    currentTask = await executeAction(
      developer,
      task.id,
      findAction(currentTask, "RESOLVE_BLOCKED"),
    );
    currentTask = await executeAction(
      developer,
      task.id,
      findAction(currentTask, "SUBMIT_TEST"),
      {
        formValues: {
          testNote: "已完成开发，提交测试",
        },
      },
    );
    expect(currentTask.statusCategory).toBe("WAITING");

    const testerTaskDetail = await getWorkItem(tester, task.id);
    expect(
      testerTaskDetail.permissions.availableActions.map(
        (action) => action.code,
      ),
    ).toEqual(expect.arrayContaining(["START_TEST"]));
    currentTask = await executeAction(
      tester,
      task.id,
      findAction(testerTaskDetail, "START_TEST"),
    );
    currentTask = await executeAction(
      tester,
      task.id,
      findAction(currentTask, "PASS_TEST"),
    );
    expect(currentTask.statusCategory).toBe("DONE");

    await assertIntakeMultiTaskBreakdown({
      actor: pm,
      assignee: developer,
      requirementId: requirement.id,
      runId,
      spaceId: space.id,
      versionId: version.id,
      workflowVersionId: developmentWorkflow.id,
    });

    const commentWorkflow = await createCommentRequiredWorkflow(
      owner,
      space.id,
      runId,
    );
    const commentTask = await createTask(pm, space.id, {
      assigneeId: pm.id,
      runId: `${runId}_comment`,
      workflowVersionId: commentWorkflow.version.id,
    });
    await expectRejected(
      await post(
        pm,
        `/work-items/${commentTask.id}/actions/${commentWorkflow.action.id}/execute`,
        {
          formValues: {
            completionEvidence: "证据存在但缺少备注",
          },
        },
      ),
      "缺少必填 comment",
      [400],
    );

    const otherTask = await createTask(owner, otherSpace.id, {
      assigneeId: developer.id,
      runId: `${runId}_cross`,
    });
    const otherTaskDetail = await getWorkItem(developer, otherTask.id);
    await expectRejected(
      await post(
        developer,
        `/work-items/${task.id}/actions/${findAction(otherTaskDetail, "START_PROGRESS").id}/execute`,
        {
          formValues: {},
        },
      ),
      "跨空间动作不能作用于当前工作项",
      [400, 409],
    );

    await expectRejected(
      await get(orgOnly, `/work-items/${task.id}`),
      "非空间成员访问空间工作项",
      [403, 404],
    );
    await expectRejected(
      await get(outsider, `/organizations/${organization.id}`),
      "非组织成员访问组织",
      [403, 404],
    );
    await expectRejected(
      await get(outsider, `/work-items/${task.id}`),
      "跨组织对象访问",
      [403, 404],
    );
    await expectRejected(
      await post(outsider, `/organizations/${organization.id}/spaces`, {
        code: `${runId}_bad`.slice(0, 32),
        name: "should fail",
      }),
      "跨组织写入空间",
      [403, 404],
    );
    expect(outsiderOrganization.id).not.toBe(organization.id);

    const bug = await createBug(tester, space.id, {
      relatedTaskId: task.id,
      runId,
      versionId: version.id,
    });
    await expectRejected(
      await patch(tester, `/bugs/${bug.id}`, {
        actualResult: "TESTER 不能直接编辑 Bug 字段",
        severity: "CRITICAL",
      }),
      "TESTER 直接 PATCH Bug",
      [403],
    );
    const bugEditResponse = await patch(pm, `/bugs/${bug.id}`, {
      actualResult: "编辑后确认实际结果仍不符合预期",
      severity: "CRITICAL",
    });
    expect(
      bugEditResponse.ok(),
      `编辑 Bug 应成功：${await bugEditResponse.text()}`,
    ).toBe(true);
    let currentBug = await getBug(tester, bug.id);
    expect(currentBug.bugDetail.severity).toBe("CRITICAL");
    currentBug = await executeBugAction(tester, currentBug, "CONFIRM_DEFECT", {
      fixAssigneeId: developer.id,
    });
    expect(currentBug.statusCategory).toBe("WAITING");
    expect(currentBug.assigneeId).toBe(developer.id);

    currentBug = await executeBugAction(developer, currentBug, "START_FIX");
    expect(currentBug.statusCategory).toBe("IN_PROGRESS");
    currentBug = await executeBugAction(
      developer,
      currentBug,
      "SUBMIT_REGRESSION",
      {
        fixSummary: "已修复第一次提交",
      },
    );
    expect(currentBug.statusCategory).toBe("VERIFYING");
    currentBug = await executeBugAction(tester, currentBug, "REGRESSION_FAIL", {
      failedReason: "回归仍失败",
    });
    expect(currentBug.statusCategory).toBe("IN_PROGRESS");
    currentBug = await executeBugAction(
      developer,
      currentBug,
      "SUBMIT_REGRESSION",
      {
        fixSummary: "再次修复后提交",
      },
    );
    currentBug = await executeBugAction(tester, currentBug, "REGRESSION_PASS", {
      regressionConclusion: "回归通过",
    });
    expect(currentBug.statusCategory).toBe("DONE");
    expect(currentBug.bugDetail.regressionResult).toBe("回归通过");
    currentBug = await executeBugAction(tester, currentBug, "CLOSE_DEFECT");
    expect(currentBug.statusCategory).toBe("DONE");
    currentBug = await executeBugAction(tester, currentBug, "REOPEN_DEFECT", {
      reopenReason: "线上复现，需要重新打开",
    });
    expect(currentBug.statusCategory).toBe("WAITING");

    await updateTaskAssignee(pm, task.id, pm.id);
    const taskTimeline = await listWorkItemTimeline(pm, task.id);
    expect(taskTimeline.items.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "CREATED",
        "ACTION_EXECUTED",
        "ASSIGNEE_CHANGED",
        "CLOSED",
      ]),
    );
    const bugTimeline = await listWorkItemTimeline(tester, bug.id);
    expect(bugTimeline.items.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "CREATED",
        "ACTION_EXECUTED",
        "ASSIGNEE_CHANGED",
        "CLOSED",
        "REOPENED",
      ]),
    );

    const prisma = await getPrismaClient();
    try {
      const auditLogs = await findAuditLogs(prisma, organization.id, [
        bug.id,
        commentWorkflow.action.id,
        commentWorkflow.definition.id,
        commentWorkflow.field.id,
        commentWorkflow.version.id,
        task.id,
      ]);
      const actionTypes = auditLogs.map((log) => log.actionType);
      const operations = auditLogs
        .map((log) => readAuditOperation(log.metadata))
        .filter((operation): operation is string => Boolean(operation));

      expect(actionTypes).toEqual(
        expect.arrayContaining(["ACCESS_DENIED", "CREATE", "UPDATE"]),
      );
      expect(operations).toEqual(
        expect.arrayContaining([
          "executeWorkflowAction",
          "executeWorkflowActionDenied",
          "executeWorkflowActionValidationFailed",
          "createActionFormField",
          "createWorkflowDefinition",
          "createWorkflowVersion",
          "publishWorkflowVersion",
        ]),
      );
      expect(auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionType: "CREATE",
            targetId: bug.id,
            targetType: "BUG",
          }),
          expect.objectContaining({
            actionType: "UPDATE",
            targetId: bug.id,
            targetType: "BUG",
          }),
        ]),
      );
    } finally {
      await prisma.$disconnect();
    }
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

async function executeBugAction(
  actor: M3User,
  bug: { id: string },
  actionCode: string,
  formValues: Record<string, unknown> = {},
) {
  const detail = await getBug(actor, bug.id);
  const updated = await executeAction(
    actor,
    bug.id,
    findAction(detail, actionCode),
    {
      formValues,
    },
  );

  return getBug(actor, updated.id);
}

async function assertRequirementImageUploadChain(
  actor: M3User,
  requirementId: string,
) {
  const file = {
    fileName: `requirement-image-${requirementId}.png`,
    mimeType: "image/png",
    size: 512,
    targetId: requirementId,
    targetType: "REQUIREMENT",
  } as const;
  const presigned = await expectData(
    await post(actor, "/attachments/presign", file),
    PresignAttachmentResponseSchema,
    "POST /attachments/presign for requirement image",
  );

  expect(presigned.fileKey).toContain(`/requirement/${requirementId}/`);
  expect(presigned.uploadUrl).toContain(encodeURIComponent(presigned.fileKey));

  const attachment = await expectData(
    await post(actor, "/attachments", {
      ...file,
      fileKey: presigned.fileKey,
    }),
    CreateAttachmentResponseSchema,
    "POST /attachments for requirement image",
  );

  expect(attachment).toMatchObject({
    fileKey: presigned.fileKey,
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    targetId: requirementId,
    targetType: "REQUIREMENT",
  });

  const attachments = await expectData(
    await get(
      actor,
      `/attachments?targetType=REQUIREMENT&targetId=${requirementId}&pageSize=20`,
    ),
    ListAttachmentsResponseSchema,
    "GET /attachments for requirement image",
  );
  expect(attachments.items.map((item) => item.id)).toContain(attachment.id);

  const requirement = await expectData(
    await get(actor, `/requirements/${requirementId}`),
    GetRequirementResponseSchema,
    "GET /requirements/:requirementId after image attachment",
  );
  expect(requirement.attachments?.map((item) => item.id)).toContain(
    attachment.id,
  );

  const downloadUrl = await expectData(
    await get(actor, `/attachments/${attachment.id}/download-url`),
    GetAttachmentDownloadUrlResponseSchema,
    "GET /attachments/:attachmentId/download-url",
  );
  expect(downloadUrl.downloadUrl).toContain(
    encodeURIComponent(presigned.fileKey),
  );
}

async function assertIntakeMultiTaskBreakdown(input: {
  actor: M3User;
  assignee: M3User;
  requirementId: string;
  runId: string;
  spaceId: string;
  versionId: string;
  workflowVersionId: string;
}) {
  const intake = await expectData(
    await post(input.actor, `/spaces/${input.spaceId}/intake-items`, {
      assigneeId: input.assignee.id,
      description: "由需求拆解为多个开发任务",
      priority: "HIGH",
      requirementId: input.requirementId,
      sourceObject: {
        requirementId: input.requirementId,
      },
      sourceType: "REQUIREMENT_CHANGE",
      title: `M3 Intake ${input.runId}`,
      versionId: input.versionId,
    }),
    CreateIntakeItemResponseSchema,
    "POST /spaces/:spaceId/intake-items",
  );

  const accepted = await expectData(
    await post(input.actor, `/intake-items/${intake.id}/accept`, {}),
    AcceptIntakeItemResponseSchema,
    "POST /intake-items/:id/accept",
  );
  expect(accepted.status).toBe("ACCEPTED");

  const converted = await expectData(
    await post(
      input.actor,
      `/intake-items/${intake.id}/convert-to-work-items`,
      {
        tasks: [
          {
            assigneeId: input.assignee.id,
            description: "拆解任务一",
            priority: "HIGH",
            requirementId: input.requirementId,
            title: `M3 Split Task A ${input.runId}`,
            versionId: input.versionId,
            workflowVersionId: input.workflowVersionId,
          },
          {
            assigneeId: input.assignee.id,
            description: "拆解任务二",
            priority: "MEDIUM",
            requirementId: input.requirementId,
            title: `M3 Split Task B ${input.runId}`,
            versionId: input.versionId,
            workflowVersionId: input.workflowVersionId,
          },
        ],
      },
    ),
    ConvertIntakeItemToWorkItemsResponseSchema,
    "POST /intake-items/:id/convert-to-work-items",
  );
  expect(converted.intakeItemId).toBe(intake.id);
  expect(converted.workItems).toHaveLength(2);
  expect(converted.workItems.map((item) => item.title)).toEqual(
    expect.arrayContaining([
      `M3 Split Task A ${input.runId}`,
      `M3 Split Task B ${input.runId}`,
    ]),
  );
  expect(
    converted.workItems.every(
      (item) =>
        item.intakeItemId === intake.id &&
        item.requirementId === input.requirementId &&
        item.versionId === input.versionId &&
        item.assigneeId === input.assignee.id,
    ),
  ).toBe(true);

  const listed = await expectData(
    await get(
      input.actor,
      `/spaces/${input.spaceId}/work-items?intakeItemId=${intake.id}&pageSize=20`,
    ),
    ListWorkItemsResponseSchema,
    "GET /spaces/:spaceId/work-items by intakeItemId",
  );
  expect(listed.items.map((item) => item.id)).toEqual(
    expect.arrayContaining(converted.workItems.map((item) => item.id)),
  );

  await expectRejected(
    await post(
      input.actor,
      `/intake-items/${intake.id}/convert-to-work-items`,
      {
        tasks: [
          {
            title: `M3 Split Task C ${input.runId}`,
            workflowVersionId: input.workflowVersionId,
          },
        ],
      },
    ),
    "已转换事项不能重复拆解",
    [409],
  );
}

function readAuditOperation(metadata: unknown) {
  if (
    metadata &&
    typeof metadata === "object" &&
    "operation" in metadata &&
    typeof metadata.operation === "string"
  ) {
    return metadata.operation;
  }

  return undefined;
}
