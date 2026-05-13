import {
  expect,
  request,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import type { z } from "zod";
import {
  apiResponseSchema,
  type ActionFormFieldSummary,
  type BugView,
  type DefaultWorkflowCode,
  type Organization,
  type OrganizationMemberWithUser,
  type PageResult,
  type Space,
  type SpaceMemberWithUser,
  type SpaceRole,
  type TimelineEvent,
  type Version,
  type WorkflowActionSummary,
  type WorkflowDefinition,
  type WorkflowState,
  type WorkflowVersion,
  type WorkItem,
  type WorkItemDetail,
} from "../../../packages/shared/src/index";
import {
  AddOrganizationMemberResponseSchema,
  AddSpaceMemberResponseSchema,
  CreateActionFormFieldResponseSchema,
  CreateBugResponseSchema,
  CreateOrganizationResponseSchema,
  CreateSpaceResponseSchema,
  CreateVersionResponseSchema,
  CreateWorkflowActionResponseSchema,
  CreateWorkflowBindingResponseSchema,
  CreateWorkflowDefinitionResponseSchema,
  CreateWorkflowStateResponseSchema,
  CreateWorkflowVersionResponseSchema,
  CreateWorkItemResponseSchema,
  GetBugResponseSchema,
  GetSpaceOverviewViewResponseSchema,
  GetWorkflowVersionResponseSchema,
  GetWorkItemResponseSchema,
  LoginResponseSchema,
  PublishWorkflowVersionResponseSchema,
  RegisterResponseSchema,
  TimelineResponseSchema,
  UpdateRequirementResponseSchema,
  UpdateWorkItemResponseSchema,
} from "../../../packages/shared/src/index";
import {
  Prisma,
  PrismaClient,
  type PrismaClient as PrismaClientInstance,
} from "../../../apps/api/src/generated/prisma/client";
import {
  authenticatedRequestHeaders,
  apiPath,
  buildRunId,
  cookieHeaderFromSetCookieHeaders,
  e2eEnv,
  missingStaticPrerequisite,
  probeApi,
  probeWeb,
  unsafeAuthenticatedRequestHeaders,
  unsafeRequestHeaders,
} from "./m0-env";

type ApiSchema<T> = z.ZodType<T>;

type PrismaClientConstructor = new (
  options: Prisma.PrismaClientOptions,
) => PrismaClientInstance;

const PrismaClientWithOptions =
  PrismaClient as unknown as PrismaClientConstructor;

let requestIpSequence = 10;

export type M3User = {
  context: APIRequestContext;
  cookie: string;
  id: string;
  ip: string;
  password: string;
  username: string;
};

export type M3AuditLog = {
  actionType: string;
  targetId: string;
  targetType: string;
};

export function buildM3RunId(): string {
  return `m3_${buildRunId()}`.slice(0, 28);
}

export async function skipWhenM3EnvironmentUnavailable(): Promise<void> {
  const reason = await resolveM3EnvironmentSkipReason();
  test.skip(Boolean(reason), reason);
}

export async function registerAndLoginUser(
  username: string,
  password: string,
): Promise<M3User> {
  const ip = nextTestIp();
  const registrationContext = await request.newContext({
    baseURL: `${e2eEnv.apiBaseURL}/`,
  });

  try {
    const registerResponse = await registrationContext.post(
      apiPath("/auth/register"),
      {
        data: {
          username,
          password,
          confirmPassword: password,
        },
        headers: unsafeRequestHeadersForIp(ip),
      },
    );

    const registered = await expectData(
      registerResponse,
      RegisterResponseSchema,
      "POST /auth/register",
    );

    const context = await request.newContext({
      baseURL: `${e2eEnv.apiBaseURL}/`,
    });
    const loginResponse = await context.post(apiPath("/auth/login"), {
      data: {
        username,
        password,
      },
      headers: unsafeRequestHeadersForIp(ip),
    });

    await expectData(loginResponse, LoginResponseSchema, "POST /auth/login");

    return {
      context,
      cookie: cookieHeaderFromSetCookieHeaders(
        loginResponse
          .headersArray()
          .filter(({ name }) => name.toLowerCase() === "set-cookie")
          .map(({ value }) => value),
      ),
      id: registered.user.id,
      ip,
      password,
      username,
    };
  } finally {
    await registrationContext.dispose();
  }
}

export async function createOrganization(
  user: M3User,
  runId: string,
): Promise<Organization> {
  const response = await post(user, "/organizations", {
    code: `${runId}_org`.slice(0, 32),
    name: `M3 Org ${runId}`,
  });

  return expectData(
    response,
    CreateOrganizationResponseSchema,
    "POST /organizations",
  );
}

export async function addOrganizationMember(
  actor: M3User,
  organizationId: string,
  username: string,
): Promise<OrganizationMemberWithUser> {
  const response = await post(
    actor,
    `/organizations/${organizationId}/members`,
    {
      role: "MEMBER",
      username,
    },
  );

  return expectData(
    response,
    AddOrganizationMemberResponseSchema,
    "POST /organizations/:organizationId/members",
  );
}

export async function createSpace(
  actor: M3User,
  organizationId: string,
  runId: string,
  suffix: string,
): Promise<Space> {
  const response = await post(
    actor,
    `/organizations/${organizationId}/spaces`,
    {
      code: `${runId}_${suffix}`.slice(0, 32),
      name: `M3 ${suffix} ${runId}`,
    },
  );

  return expectData(
    response,
    CreateSpaceResponseSchema,
    "POST /organizations/:organizationId/spaces",
  );
}

export async function addSpaceMember(
  actor: M3User,
  spaceId: string,
  userId: string,
  role: SpaceRole,
): Promise<SpaceMemberWithUser> {
  const response = await post(actor, `/spaces/${spaceId}/members`, {
    role,
    userId,
  });

  return expectData(
    response,
    AddSpaceMemberResponseSchema,
    "POST /spaces/:spaceId/members",
  );
}

export async function createVersion(
  actor: M3User,
  spaceId: string,
  runId: string,
): Promise<Version> {
  const response = await post(actor, `/spaces/${spaceId}/versions`, {
    name: `M3 Version ${runId}`,
    status: "IN_PROGRESS",
    target: "覆盖 M3 自动化主链路",
  });

  return expectData(
    response,
    CreateVersionResponseSchema,
    "POST /spaces/:spaceId/versions",
  );
}

export async function createConfirmedRequirement(
  actor: M3User,
  spaceId: string,
  versionId: string,
  runId: string,
) {
  const draftResponse = await post(actor, `/spaces/${spaceId}/requirements`, {
    versionId,
  });
  const draft = await expectData(
    draftResponse,
    UpdateRequirementResponseSchema,
    "POST /spaces/:spaceId/requirements",
  );
  const response = await patch(actor, `/requirements/${draft.id}`, {
    contentJson: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    contentText: "M3 自动化主链路需求",
    priority: "HIGH",
    title: `M3 Requirement ${runId}`,
    versionId,
  });

  return expectData(
    response,
    UpdateRequirementResponseSchema,
    "PATCH /requirements/:requirementId",
  );
}

export async function defaultWorkflowVersion(
  actor: M3User,
  spaceId: string,
  code: DefaultWorkflowCode,
): Promise<WorkflowVersion> {
  const overviewResponse = await get(
    actor,
    `/views/spaces/${spaceId}/overview`,
  );
  const overview = await expectData(
    overviewResponse,
    GetSpaceOverviewViewResponseSchema,
    "GET /views/spaces/:spaceId/overview",
  );
  const summary = overview.defaultWorkflows.find((item) => item.code === code);

  expect(summary, `空间应初始化 ${code} 默认流程`).toBeDefined();

  const response = await get(
    actor,
    `/workflow-versions/${summary?.workflowVersionId}`,
  );

  return expectData(
    response,
    GetWorkflowVersionResponseSchema,
    "GET /workflow-versions/:workflowVersionId",
  );
}

export async function createTask(
  actor: M3User,
  spaceId: string,
  input: {
    assigneeId?: string;
    requirementId?: string;
    runId: string;
    versionId?: string;
    workflowVersionId?: string;
  },
): Promise<WorkItem> {
  const response = await post(actor, `/spaces/${spaceId}/work-items`, {
    assigneeId: input.assigneeId,
    priority: "HIGH",
    requirementId: input.requirementId,
    title: `M3 Task ${input.runId}`,
    type: "TASK",
    versionId: input.versionId,
    workflowVersionId: input.workflowVersionId,
  });

  return expectData(
    response,
    CreateWorkItemResponseSchema,
    "POST /spaces/:spaceId/work-items",
  );
}

export async function createBug(
  actor: M3User,
  spaceId: string,
  input: {
    relatedTaskId?: string;
    runId: string;
    versionId?: string;
  },
): Promise<BugView> {
  const response = await post(actor, `/spaces/${spaceId}/bugs`, {
    actualResult: "实际结果不符合预期",
    expectedResult: "应该通过主链路验收",
    priority: "URGENT",
    relatedTaskId: input.relatedTaskId,
    severity: "MAJOR",
    stepsToReproduce: "1. 执行 M3 主链路\n2. 观察缺陷状态",
    title: `M3 Bug ${input.runId}`,
    versionId: input.versionId,
  });

  return expectData(
    response,
    CreateBugResponseSchema,
    "POST /spaces/:spaceId/bugs",
  );
}

export async function getWorkItem(
  actor: M3User,
  workItemId: string,
): Promise<WorkItemDetail> {
  const response = await get(actor, `/work-items/${workItemId}`);

  return expectData(response, GetWorkItemResponseSchema, "GET /work-items/:id");
}

export async function getBug(actor: M3User, bugId: string): Promise<BugView> {
  const response = await get(actor, `/bugs/${bugId}`);

  return expectData(response, GetBugResponseSchema, "GET /bugs/:id");
}

export async function updateTaskAssignee(
  actor: M3User,
  workItemId: string,
  assigneeId: string,
): Promise<WorkItem> {
  const response = await patch(actor, `/work-items/${workItemId}`, {
    assigneeId,
  });

  return expectData(
    response,
    UpdateWorkItemResponseSchema,
    "PATCH /work-items/:workItemId",
  );
}

export async function executeAction(
  actor: M3User,
  workItemId: string,
  action: WorkflowActionSummary,
  input: {
    comment?: string;
    formValues?: Record<string, unknown>;
  } = {},
): Promise<WorkItemDetail> {
  const response = await post(
    actor,
    `/work-items/${workItemId}/actions/${action.id}/execute`,
    {
      comment: input.comment,
      formValues: input.formValues ?? {},
    },
  );

  return expectData(
    response,
    GetWorkItemResponseSchema,
    "POST /work-items/:workItemId/actions/:actionId/execute",
  );
}

export async function expectRejected(
  response: APIResponse,
  label: string,
  statuses: readonly number[] = [400, 403, 404, 409],
): Promise<void> {
  expect(
    statuses,
    `${label} 应拒绝请求，实际 HTTP ${response.status()}：${await response.text()}`,
  ).toContain(response.status());
}

export async function createCommentRequiredWorkflow(
  actor: M3User,
  spaceId: string,
  runId: string,
): Promise<{
  action: WorkflowActionSummary;
  definition: WorkflowDefinition;
  done: WorkflowState;
  field: ActionFormFieldSummary;
  start: WorkflowState;
  version: WorkflowVersion;
}> {
  const definition = await expectData(
    await post(actor, `/spaces/${spaceId}/workflows`, {
      code: `COMMENT_REQUIRED_${runId}`.slice(0, 80),
      name: `M3 Comment Required ${runId}`,
    }),
    CreateWorkflowDefinitionResponseSchema,
    "POST /spaces/:spaceId/workflows",
  );
  const draft = await expectData(
    await post(actor, `/workflows/${definition.id}/versions`, {}),
    CreateWorkflowVersionResponseSchema,
    "POST /workflows/:workflowId/versions",
  );
  const start = await expectData(
    await post(actor, `/workflow-versions/${draft.id}/states`, {
      category: "NOT_STARTED",
      code: "PENDING",
      isStart: true,
      name: "待处理",
      order: 0,
    }),
    CreateWorkflowStateResponseSchema,
    "POST /workflow-versions/:workflowVersionId/states",
  );
  const done = await expectData(
    await post(actor, `/workflow-versions/${draft.id}/states`, {
      category: "DONE",
      code: "DONE",
      isEnd: true,
      name: "已完成",
      order: 1,
    }),
    CreateWorkflowStateResponseSchema,
    "POST /workflow-versions/:workflowVersionId/states",
  );
  const action = await expectData(
    await post(actor, `/workflow-versions/${draft.id}/actions`, {
      allowedSpaceRoles: ["PM"],
      code: "COMPLETE_WITH_COMMENT",
      fromStateId: start.id,
      name: "带备注完成",
      order: 0,
      requiresComment: true,
      toStateId: done.id,
    }),
    CreateWorkflowActionResponseSchema,
    "POST /workflow-versions/:workflowVersionId/actions",
  );
  const field = await createRequiredFormField(actor, action.id, {
    fieldType: "TEXTAREA",
    key: "completionEvidence",
    label: "完成证据",
  });
  const version = await expectData(
    await post(actor, `/workflow-versions/${draft.id}/publish`, {}),
    PublishWorkflowVersionResponseSchema,
    "POST /workflow-versions/:workflowVersionId/publish",
  );
  await expectData(
    await post(actor, `/spaces/${spaceId}/workflow-bindings`, {
      isDefault: false,
      workflowVersionId: version.id,
      workItemType: "TASK",
    }),
    CreateWorkflowBindingResponseSchema,
    "POST /spaces/:spaceId/workflow-bindings",
  );

  return {
    action,
    definition,
    done,
    field,
    start,
    version,
  };
}

export async function createRequiredFormField(
  actor: M3User,
  actionId: string,
  input: {
    fieldType: ActionFormFieldSummary["fieldType"];
    key: string;
    label: string;
  },
): Promise<ActionFormFieldSummary> {
  const response = await post(
    actor,
    `/workflow-actions/${actionId}/form-fields`,
    {
      fieldType: input.fieldType,
      key: input.key,
      label: input.label,
      required: true,
    },
  );

  return expectData(
    response,
    CreateActionFormFieldResponseSchema,
    "POST /workflow-actions/:actionId/form-fields",
  );
}

export async function listWorkItemTimeline(
  actor: M3User,
  workItemId: string,
): Promise<PageResult<TimelineEvent>> {
  const response = await get(actor, `/work-items/${workItemId}/timeline`);

  return expectData(
    response,
    TimelineResponseSchema,
    "GET /work-items/:workItemId/timeline",
  );
}

export function findAction(
  detailOrVersion: WorkItemDetail | WorkflowVersion | BugView,
  code: string,
): WorkflowActionSummary {
  const actions =
    "permissions" in detailOrVersion
      ? (detailOrVersion.permissions?.availableActions ?? [])
      : detailOrVersion.actions;
  const action = actions.find((item) => item.code === code);

  expect(action, `应存在流程动作 ${code}`).toBeDefined();

  return action as WorkflowActionSummary;
}

export async function getPrismaClient(): Promise<PrismaClientInstance> {
  const databaseUrl = process.env.DATABASE_URL;

  test.skip(!databaseUrl, "M3 审计验证需要 DATABASE_URL 指向当前 API 测试库。");

  const prisma = new PrismaClientWithOptions({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
    errorFormat: "minimal",
  } as Prisma.PrismaClientOptions);

  await prisma.$connect();

  return prisma;
}

export async function findAuditLogs(
  prisma: PrismaClientInstance,
  organizationId: string,
  targetIds: readonly string[],
): Promise<M3AuditLog[]> {
  return prisma.auditLog.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      actionType: true,
      targetId: true,
      targetType: true,
    },
    where: {
      organizationId,
      targetId: {
        in: [...targetIds],
      },
    },
  });
}

export function m3AuthHeaders(user: M3User): Record<string, string> {
  return withForwardedFor(authenticatedRequestHeaders(user.cookie), user.ip);
}

export function m3UnsafeAuthHeaders(user: M3User): Record<string, string> {
  return withForwardedFor(
    unsafeAuthenticatedRequestHeaders(user.cookie),
    user.ip,
  );
}

export function get(actor: M3User, path: string): Promise<APIResponse> {
  return actor.context.get(apiPath(path), {
    headers: m3AuthHeaders(actor),
  });
}

export function post(
  actor: M3User,
  path: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return actor.context.post(apiPath(path), {
    data,
    headers: m3UnsafeAuthHeaders(actor),
  });
}

export function patch(
  actor: M3User,
  path: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return actor.context.patch(apiPath(path), {
    data,
    headers: m3UnsafeAuthHeaders(actor),
  });
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

async function resolveM3EnvironmentSkipReason(): Promise<string | undefined> {
  const staticReason = missingStaticPrerequisite();
  if (staticReason) {
    return staticReason.replaceAll("M0 E2E", "M3 E2E");
  }

  const apiProbe = await probeApi();
  if (!apiProbe.ok) {
    return apiProbe.reason?.replaceAll("M0 E2E", "M3 E2E");
  }

  if (e2eEnv.requireWeb) {
    const webProbe = await probeWeb();
    if (!webProbe.ok) {
      return webProbe.reason?.replaceAll("M0 E2E", "M3 E2E");
    }
  }

  return undefined;
}

function unsafeRequestHeadersForIp(ip: string): Record<string, string> {
  return withForwardedFor(unsafeRequestHeaders(), ip);
}

function withForwardedFor(
  headers: Record<string, string>,
  ip: string,
): Record<string, string> {
  return {
    ...headers,
    "x-forwarded-for": ip,
  };
}

function nextTestIp(): string {
  requestIpSequence += 1;

  return `203.0.113.${requestIpSequence}`;
}
