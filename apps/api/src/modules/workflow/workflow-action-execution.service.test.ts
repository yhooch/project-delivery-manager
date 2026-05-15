import { describe, expect, it } from "vitest";

import type { SpaceRole } from "@project-delivery/shared";
import { WorkflowActionExecutionService } from "./workflow-action-execution.service";
import type {
  CreateWorkflowActionAuditLogInput,
  CreateWorkflowActionTimelineInput,
  ExecutableWorkflowAction,
  ExecutableWorkflowActionFormField,
  ExecutableWorkItem,
  ReplaceWorkflowActionParticipantsInput,
  UpdateWorkflowActionStateInput,
  WorkflowActionActorSpaceAccess,
  WorkflowActionExecutionRepository,
  WorkflowActionExecutionTransaction,
} from "./workflow-action-execution.repository";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const ASSIGNEE_ID = "01H00000000000000000000003";
const REPORTER_ID = "01H00000000000000000000004";
const WORK_ITEM_ID = "01H00000000000000000000005";
const WORKFLOW_VERSION_ID = "01H00000000000000000000006";
const PENDING_STATE_ID = "01H00000000000000000000007";
const IN_PROGRESS_STATE_ID = "01H00000000000000000000008";
const BLOCKED_STATE_ID = "01H00000000000000000000009";
const DONE_STATE_ID = "01H0000000000000000000000A";
const START_ACTION_ID = "01H0000000000000000000000B";
const SUBMIT_ACTION_ID = "01H0000000000000000000000C";
const BLOCK_ACTION_ID = "01H0000000000000000000000D";
const UNBLOCK_ACTION_ID = "01H0000000000000000000000E";
const USER_FIELD_ACTION_ID = "01H0000000000000000000000F";
const FIELD_ID = "01H0000000000000000000000G";

describe("WorkflowActionExecutionService", () => {
  it("executes a valid action, writes ACTION_EXECUTED, and returns latest available actions", async () => {
    const subject = createSubject("DEVELOPER");
    subject.repository.actions.set(
      START_ACTION_ID,
      makeAction({
        id: START_ACTION_ID,
        toState: state("IN_PROGRESS", IN_PROGRESS_STATE_ID, "IN_PROGRESS"),
        toStateId: IN_PROGRESS_STATE_ID,
      }),
    );
    subject.repository.actions.set(
      SUBMIT_ACTION_ID,
      makeAction({
        actorRelations: ["ASSIGNEE"],
        allowedSpaceRoles: [],
        code: "SUBMIT_TEST",
        formFields: [
          makeField({
            key: "testNote",
            label: "提测说明",
            required: true,
          }),
        ],
        fromState: state("IN_PROGRESS", IN_PROGRESS_STATE_ID, "IN_PROGRESS"),
        fromStateId: IN_PROGRESS_STATE_ID,
        id: SUBMIT_ACTION_ID,
        name: "提交提测",
        toState: state("DONE", DONE_STATE_ID, "DONE", true),
        toStateId: DONE_STATE_ID,
      }),
    );

    const detail = await subject.service.executeAction(
      ACTOR_ID,
      WORK_ITEM_ID,
      START_ACTION_ID,
      {
        formValues: {},
      },
    );

    expect(detail).toMatchObject({
      currentStateId: IN_PROGRESS_STATE_ID,
      statusCategory: "IN_PROGRESS",
    });
    expect(detail.lastActionAt).toBeDefined();
    expect(detail.permissions.availableActions).toHaveLength(1);
    expect(detail.permissions.availableActions[0]).toMatchObject({
      code: "SUBMIT_TEST",
      formFields: [
        {
          key: "testNote",
          required: true,
        },
      ],
    });
    expect(subject.repository.timelineEvents).toHaveLength(1);
    expect(subject.repository.timelineEvents[0]).toMatchObject({
      after: {
        currentStateId: IN_PROGRESS_STATE_ID,
        statusCategory: "IN_PROGRESS",
      },
      before: {
        currentStateId: PENDING_STATE_ID,
        statusCategory: "NOT_STARTED",
      },
      eventType: "ACTION_EXECUTED",
      metadata: {
        actionCode: "START_PROGRESS",
        actionId: START_ACTION_ID,
        fromStateId: PENDING_STATE_ID,
        toStateId: IN_PROGRESS_STATE_ID,
      },
      targetId: WORK_ITEM_ID,
    });
    expect(subject.repository.auditLogs).toHaveLength(1);
    expect(subject.repository.auditLogs[0]).toMatchObject({
      actionType: "WORKFLOW_ACTION_EXECUTED",
      targetId: WORK_ITEM_ID,
    });
  });

  it("rejects actions whose fromStateId does not match the current state", async () => {
    const subject = createSubject("DEVELOPER", {
      currentStateId: IN_PROGRESS_STATE_ID,
      statusCategory: "IN_PROGRESS",
    });
    subject.repository.actions.set(START_ACTION_ID, makeAction());

    await expect(
      subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, START_ACTION_ID, {
        formValues: {},
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_ACTION_STATE_CONFLICT",
    });
  });

  it("rejects users without allowed space role or actor relation", async () => {
    const subject = createSubject("DEVELOPER", {
      assigneeId: ASSIGNEE_ID,
      reporterId: REPORTER_ID,
    });
    subject.repository.actions.set(
      START_ACTION_ID,
      makeAction({
        actorRelations: ["REPORTER"],
        allowedSpaceRoles: ["PM"],
      }),
    );

    await expect(
      subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, START_ACTION_ID, {
        formValues: {},
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_ACTION_PERMISSION_DENIED",
    });
    expect(subject.repository.auditLogs).toHaveLength(1);
    expect(subject.repository.auditLogs[0]).toMatchObject({
      actionType: "WORKFLOW_ACTION_PERMISSION_DENIED",
      metadata: {
        errorCode: "WORKFLOW_ACTION_PERMISSION_DENIED",
      },
    });
  });

  it("rejects VIEWER execution even when a legacy action lists VIEWER", async () => {
    const subject = createSubject("VIEWER");
    subject.repository.actions.set(
      START_ACTION_ID,
      makeAction({
        actorRelations: [],
        allowedSpaceRoles: ["VIEWER"],
      }),
    );

    await expect(
      subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, START_ACTION_ID, {
        formValues: {},
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_ACTION_PERMISSION_DENIED",
    });
    await expect(
      subject.service.resolvePermissionSnapshot(ACTOR_ID, WORK_ITEM_ID),
    ).resolves.toMatchObject({
      availableActions: [],
      canComment: false,
      canEdit: false,
      canUploadAttachment: false,
    });
  });

  it("rejects missing required form fields", async () => {
    const subject = createSubject("DEVELOPER");
    subject.repository.actions.set(
      SUBMIT_ACTION_ID,
      makeAction({
        formFields: [
          makeField({
            key: "testNote",
            label: "提测说明",
            required: true,
          }),
        ],
        id: SUBMIT_ACTION_ID,
      }),
    );

    await expect(
      subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, SUBMIT_ACTION_ID, {
        formValues: {},
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_ACTION_FORM_INVALID",
      details: {
        field: "testNote",
      },
    });
  });

  it("rejects form values that are not configured on the action", async () => {
    const subject = createSubject("DEVELOPER");
    subject.repository.actions.set(
      SUBMIT_ACTION_ID,
      makeAction({
        formFields: [
          makeField({
            key: "testNote",
            label: "提测说明",
          }),
        ],
        id: SUBMIT_ACTION_ID,
      }),
    );

    await expect(
      subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, SUBMIT_ACTION_ID, {
        formValues: {
          unexpected: "should not be accepted",
        },
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_ACTION_FORM_INVALID",
      details: {
        field: "unexpected",
      },
    });
  });

  it("rejects actions that require comments when comment is blank", async () => {
    const subject = createSubject("DEVELOPER");
    subject.repository.actions.set(
      START_ACTION_ID,
      makeAction({
        requiresComment: true,
      }),
    );

    await expect(
      subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, START_ACTION_ID, {
        comment: " ",
        formValues: {},
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_ACTION_COMMENT_REQUIRED",
    });
  });

  it("sets and clears current blocking information through block and unblock actions", async () => {
    const subject = createSubject("DEVELOPER", {
      currentStateId: IN_PROGRESS_STATE_ID,
      statusCategory: "IN_PROGRESS",
    });
    subject.repository.actions.set(
      BLOCK_ACTION_ID,
      makeAction({
        code: "MARK_BLOCKED",
        formFields: [
          makeField({
            key: "blockedReason",
            label: "阻塞原因",
            required: true,
          }),
        ],
        fromState: state("IN_PROGRESS", IN_PROGRESS_STATE_ID, "IN_PROGRESS"),
        fromStateId: IN_PROGRESS_STATE_ID,
        id: BLOCK_ACTION_ID,
        name: "标记阻塞",
        toState: state("BLOCKED", BLOCKED_STATE_ID, "WAITING"),
        toStateId: BLOCKED_STATE_ID,
      }),
    );
    subject.repository.actions.set(
      UNBLOCK_ACTION_ID,
      makeAction({
        code: "RESOLVE_BLOCKED",
        fromState: state("BLOCKED", BLOCKED_STATE_ID, "WAITING"),
        fromStateId: BLOCKED_STATE_ID,
        id: UNBLOCK_ACTION_ID,
        name: "解除阻塞",
        toState: state("IN_PROGRESS", IN_PROGRESS_STATE_ID, "IN_PROGRESS"),
        toStateId: IN_PROGRESS_STATE_ID,
      }),
    );

    const blocked = await subject.service.executeAction(
      ACTOR_ID,
      WORK_ITEM_ID,
      BLOCK_ACTION_ID,
      {
        formValues: {
          blockedReason: "等待依赖",
        },
      },
    );

    expect(blocked).toMatchObject({
      blockedReason: "等待依赖",
      currentStateId: BLOCKED_STATE_ID,
      statusCategory: "WAITING",
    });
    expect(blocked.blockedAt).toBeDefined();

    const unblocked = await subject.service.executeAction(
      ACTOR_ID,
      WORK_ITEM_ID,
      UNBLOCK_ACTION_ID,
      {
        formValues: {},
      },
    );

    expect(unblocked).toMatchObject({
      currentStateId: IN_PROGRESS_STATE_ID,
      statusCategory: "IN_PROGRESS",
    });
    expect(unblocked.blockedReason).toBeUndefined();
    expect(unblocked.blockedAt).toBeUndefined();
    expect(subject.repository.timelineEvents).toHaveLength(2);
    expect(subject.repository.timelineEvents[1]).toMatchObject({
      after: {
        blockedAt: null,
        blockedReason: null,
      },
      metadata: {
        actionCode: "RESOLVE_BLOCKED",
      },
    });
  });

  it("validates USER form fields against active space members", async () => {
    const subject = createSubject("TESTER");
    subject.repository.actions.set(
      USER_FIELD_ACTION_ID,
      makeAction({
        allowedSpaceRoles: ["TESTER"],
        formFields: [
          makeField({
            fieldType: "USER",
            key: "fixAssigneeId",
            label: "修复负责人",
            required: true,
          }),
        ],
        id: USER_FIELD_ACTION_ID,
      }),
    );

    await expect(
      subject.service.executeAction(
        ACTOR_ID,
        WORK_ITEM_ID,
        USER_FIELD_ACTION_ID,
        {
          formValues: {
            fixAssigneeId: ASSIGNEE_ID,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "SPACE_MEMBER_INVALID",
      details: {
        field: "fixAssigneeId",
      },
    });
  });

  it("hides non-testing TASK action execution from non-participant TESTER users", async () => {
    const subject = createSubject("TESTER", {
      assigneeId: undefined,
    });
    subject.repository.participantKeys.clear();
    subject.repository.actions.set(
      START_ACTION_ID,
      makeAction({
        actorRelations: [],
        allowedSpaceRoles: ["TESTER"],
        id: START_ACTION_ID,
      }),
    );

    await expect(
      subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, START_ACTION_ID, {
        formValues: {},
      }),
    ).rejects.toMatchObject({
      code: "WORK_ITEM_NOT_FOUND",
    });
  });

  it("allows TESTER to execute actions on non-participant testing TASKs", async () => {
    const subject = createSubject("TESTER", {
      assigneeId: undefined,
      currentState: {
        code: "READY_FOR_TEST",
        name: "待提测",
      },
    });
    subject.repository.participantKeys.clear();
    subject.repository.actions.set(
      START_ACTION_ID,
      makeAction({
        actorRelations: [],
        allowedSpaceRoles: ["TESTER"],
        id: START_ACTION_ID,
      }),
    );

    const detail = await subject.service.executeAction(
      ACTOR_ID,
      WORK_ITEM_ID,
      START_ACTION_ID,
      {
        formValues: {},
      },
    );

    expect(detail).toMatchObject({
      currentStateId: IN_PROGRESS_STATE_ID,
      statusCategory: "IN_PROGRESS",
      type: "TASK",
    });
  });

  it("updates Bug assignee side effects and ASSIGNEE participant through confirm defect", async () => {
    const subject = createSubject("TESTER", {
      assigneeId: undefined,
      type: "BUG",
    });
    subject.repository.activeMemberKeys.add(
      `${ORGANIZATION_ID}:${SPACE_ID}:${ASSIGNEE_ID}`,
    );
    subject.repository.actions.set(
      USER_FIELD_ACTION_ID,
      makeAction({
        allowedSpaceRoles: ["TESTER"],
        actorRelations: [],
        code: "CONFIRM_DEFECT",
        formFields: [
          makeField({
            fieldType: "USER",
            key: "fixAssigneeId",
            label: "修复负责人",
            required: true,
          }),
        ],
        id: USER_FIELD_ACTION_ID,
        name: "确认缺陷",
        toState: state("PENDING_FIX", IN_PROGRESS_STATE_ID, "WAITING"),
        toStateId: IN_PROGRESS_STATE_ID,
      }),
    );

    const detail = await subject.service.executeAction(
      ACTOR_ID,
      WORK_ITEM_ID,
      USER_FIELD_ACTION_ID,
      {
        formValues: {
          fixAssigneeId: ASSIGNEE_ID,
        },
      },
    );

    expect(detail).toMatchObject({
      assigneeId: ASSIGNEE_ID,
      statusCategory: "WAITING",
      type: "BUG",
    });
    expect(
      subject.repository.participantKeys.has(
        `${SPACE_ID}:${WORK_ITEM_ID}:${ASSIGNEE_ID}:ASSIGNEE`,
      ),
    ).toBe(true);
    expect(subject.repository.timelineEvents.map((event) => event.eventType)).toEqual([
      "ASSIGNEE_CHANGED",
      "ACTION_EXECUTED",
    ]);
  });

  it("updates Bug regression details from default action field keys", async () => {
    const subject = createSubject("TESTER", {
      currentStateId: IN_PROGRESS_STATE_ID,
      statusCategory: "VERIFYING",
      type: "BUG",
    });
    subject.repository.actions.set(
      SUBMIT_ACTION_ID,
      makeAction({
        allowedSpaceRoles: ["TESTER"],
        actorRelations: [],
        code: "REGRESSION_PASS",
        formFields: [
          makeField({
            key: "regressionConclusion",
            label: "回归结论",
            required: true,
          }),
        ],
        fromState: state("PENDING_REGRESSION", IN_PROGRESS_STATE_ID, "VERIFYING"),
        fromStateId: IN_PROGRESS_STATE_ID,
        id: SUBMIT_ACTION_ID,
        name: "回归通过",
        toState: state("REGRESSION_PASSED", DONE_STATE_ID, "DONE"),
        toStateId: DONE_STATE_ID,
      }),
    );

    await subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, SUBMIT_ACTION_ID, {
      formValues: {
        regressionConclusion: "回归通过",
      },
    });

    expect(subject.repository.workItems.get(WORK_ITEM_ID)?.bugDetail).toMatchObject({
      regressionById: ACTOR_ID,
      regressionResult: "回归通过",
    });
    expect(
      subject.repository.workItems.get(WORK_ITEM_ID)?.bugDetail?.regressionAt,
    ).toBeDefined();
  });

  it("sets closedAt for closing actions and clears it for reopening actions", async () => {
    const subject = createSubject("TESTER", {
      currentStateId: IN_PROGRESS_STATE_ID,
      statusCategory: "DONE",
      type: "BUG",
    });
    subject.repository.actions.set(
      SUBMIT_ACTION_ID,
      makeAction({
        allowedSpaceRoles: ["TESTER"],
        actorRelations: [],
        code: "CLOSE_DEFECT",
        fromState: state("REGRESSION_PASSED", IN_PROGRESS_STATE_ID, "DONE"),
        fromStateId: IN_PROGRESS_STATE_ID,
        id: SUBMIT_ACTION_ID,
        name: "关闭缺陷",
        toState: state("CLOSED", DONE_STATE_ID, "DONE", true),
        toStateId: DONE_STATE_ID,
      }),
    );
    subject.repository.actions.set(
      BLOCK_ACTION_ID,
      makeAction({
        allowedSpaceRoles: ["TESTER"],
        actorRelations: [],
        code: "REOPEN_DEFECT",
        formFields: [
          makeField({
            key: "reopenReason",
            label: "重开原因",
            required: true,
          }),
        ],
        fromState: state("CLOSED", DONE_STATE_ID, "DONE", true),
        fromStateId: DONE_STATE_ID,
        id: BLOCK_ACTION_ID,
        name: "重新打开",
        toState: state("PENDING_FIX", IN_PROGRESS_STATE_ID, "WAITING"),
        toStateId: IN_PROGRESS_STATE_ID,
      }),
    );

    await subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, SUBMIT_ACTION_ID, {
      formValues: {},
    });

    expect(subject.repository.workItems.get(WORK_ITEM_ID)?.closedAt).toBeDefined();
    expect(subject.repository.timelineEvents.map((event) => event.eventType)).toEqual([
      "ACTION_EXECUTED",
      "CLOSED",
    ]);

    await subject.service.executeAction(ACTOR_ID, WORK_ITEM_ID, BLOCK_ACTION_ID, {
      formValues: {
        reopenReason: "线上仍可复现",
      },
    });

    expect(subject.repository.workItems.get(WORK_ITEM_ID)?.closedAt).toBeUndefined();
    expect(subject.repository.workItems.get(WORK_ITEM_ID)?.bugDetail).toMatchObject({
      regressionById: ACTOR_ID,
      regressionResult: "线上仍可复现",
    });
    expect(subject.repository.timelineEvents.map((event) => event.eventType)).toEqual([
      "ACTION_EXECUTED",
      "CLOSED",
      "ACTION_EXECUTED",
      "REOPENED",
    ]);
  });
});

function createSubject(
  actorRole: SpaceRole,
  workItemOverrides: Partial<ExecutableWorkItem> = {},
) {
  const repository = new FakeWorkflowActionExecutionRepository();

  repository.workItems.set(
    WORK_ITEM_ID,
    makeWorkItem({
      assigneeId: ACTOR_ID,
      ...workItemOverrides,
    }),
  );
  repository.access.set(`${ORGANIZATION_ID}:${SPACE_ID}:${ACTOR_ID}`, {
    role: actorRole,
  });
  repository.activeMemberKeys.add(`${ORGANIZATION_ID}:${SPACE_ID}:${ACTOR_ID}`);
  repository.participantKeys.add(
    `${SPACE_ID}:${WORK_ITEM_ID}:${ACTOR_ID}:ASSIGNEE`,
  );

  return {
    repository,
    service: new WorkflowActionExecutionService(repository),
  };
}

class FakeWorkflowActionExecutionRepository
  implements WorkflowActionExecutionRepository, WorkflowActionExecutionTransaction
{
  readonly access = new Map<string, WorkflowActionActorSpaceAccess>();
  readonly actions = new Map<string, ExecutableWorkflowAction>();
  readonly activeMemberKeys = new Set<string>();
  readonly auditLogs: CreateWorkflowActionAuditLogInput[] = [];
  readonly participantKeys = new Set<string>();
  readonly timelineEvents: CreateWorkflowActionTimelineInput[] = [];
  readonly workItems = new Map<string, ExecutableWorkItem>();

  async transaction<T>(
    handler: (tx: WorkflowActionExecutionTransaction) => Promise<T>,
  ) {
    return handler(this);
  }

  async createAuditLog(input: CreateWorkflowActionAuditLogInput) {
    this.auditLogs.push(input);
  }

  async findWorkItemById(workItemId: string) {
    return this.workItems.get(workItemId);
  }

  async findActionById(actionId: string) {
    return this.actions.get(actionId);
  }

  async findActiveSpaceAccess(input: {
    actorUserId: string;
    organizationId: string;
    spaceId: string;
  }) {
    return this.access.get(
      `${input.organizationId}:${input.spaceId}:${input.actorUserId}`,
    );
  }

  async isActiveSpaceMember(input: {
    organizationId: string;
    spaceId: string;
    userId: string;
  }) {
    return this.activeMemberKeys.has(
      `${input.organizationId}:${input.spaceId}:${input.userId}`,
    );
  }

  async isWorkItemParticipant(input: {
    spaceId: string;
    userId: string;
    workItemId: string;
  }) {
    return Array.from(this.participantKeys).some((key) =>
      key.startsWith(`${input.spaceId}:${input.workItemId}:${input.userId}:`),
    );
  }

  async updateWorkItemState(input: UpdateWorkflowActionStateInput) {
    const existing = this.workItems.get(input.workItemId);

    if (!existing || existing.currentStateId !== input.expectedCurrentStateId) {
      return undefined;
    }

    const updated: ExecutableWorkItem = {
      ...existing,
      currentStateId: input.currentStateId,
      lastActionAt: input.lastActionAt.toISOString(),
      lastStatusChangedAt: input.lastStatusChangedAt.toISOString(),
      statusCategory: input.statusCategory,
    };

    if (hasOwn(input, "assigneeId")) {
      updated.assigneeId = input.assigneeId ?? undefined;
    }
    if (hasOwn(input, "blockedReason")) {
      updated.blockedReason = input.blockedReason ?? undefined;
    }
    if (hasOwn(input, "blockedAt")) {
      updated.blockedAt = input.blockedAt?.toISOString();
    }
    if (hasOwn(input, "closedAt")) {
      updated.closedAt = input.closedAt?.toISOString();
    }
    if (input.bugDetailPatch) {
      updated.bugDetail = {
        ...updated.bugDetail,
        severity: updated.bugDetail?.severity ?? "MAJOR",
        workItemId: updated.bugDetail?.workItemId ?? updated.id,
      };

      if (hasOwn(input.bugDetailPatch, "fixNote")) {
        updated.bugDetail.fixNote = input.bugDetailPatch.fixNote ?? undefined;
      }
      if (hasOwn(input.bugDetailPatch, "regressionResult")) {
        updated.bugDetail.regressionResult =
          input.bugDetailPatch.regressionResult ?? undefined;
      }
      if (hasOwn(input.bugDetailPatch, "regressionById")) {
        updated.bugDetail.regressionById =
          input.bugDetailPatch.regressionById ?? undefined;
      }
      if (hasOwn(input.bugDetailPatch, "regressionAt")) {
        updated.bugDetail.regressionAt =
          input.bugDetailPatch.regressionAt?.toISOString();
      }
    }

    this.workItems.set(input.workItemId, updated);

    return updated;
  }

  async replaceAssigneeParticipants(
    input: ReplaceWorkflowActionParticipantsInput,
  ) {
    const prefix = `${input.spaceId}:${input.targetId}:`;

    for (const key of Array.from(this.participantKeys)) {
      if (key.startsWith(prefix) && key.endsWith(`:${input.relationType}`)) {
        this.participantKeys.delete(key);
      }
    }

    for (const userId of input.userIds) {
      this.participantKeys.add(
        `${input.spaceId}:${input.targetId}:${userId}:${input.relationType}`,
      );
    }
  }

  async createTimelineEvent(input: CreateWorkflowActionTimelineInput) {
    this.timelineEvents.push(input);
  }

  async listActionsForState(input: {
    fromStateId: string;
    workflowVersionId: string;
  }) {
    return Array.from(this.actions.values()).filter(
      (action) =>
        action.fromStateId === input.fromStateId &&
        action.workflowVersionId === input.workflowVersionId,
    );
  }
}

function makeWorkItem(overrides: Partial<ExecutableWorkItem> = {}) {
  const workItem = {
    createdById: ACTOR_ID,
    currentStateId: PENDING_STATE_ID,
    id: WORK_ITEM_ID,
    lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    priority: "MEDIUM",
    reporterId: REPORTER_ID,
    spaceId: SPACE_ID,
    statusCategory: "NOT_STARTED",
    title: "Existing task",
    type: "TASK",
    workflowVersionId: WORKFLOW_VERSION_ID,
    ...overrides,
  } satisfies ExecutableWorkItem;

  if (workItem.type === "BUG" && !workItem.bugDetail) {
    workItem.bugDetail = {
      severity: "MAJOR",
      workItemId: workItem.id,
    };
  }

  return workItem;
}

function makeAction(
  overrides: Partial<ExecutableWorkflowAction> = {},
): ExecutableWorkflowAction {
  return {
    actorRelations: ["ASSIGNEE"],
    allowedSpaceRoles: ["DEVELOPER"],
    code: "START_PROGRESS",
    formFields: [],
    fromState: state("PENDING", PENDING_STATE_ID, "NOT_STARTED"),
    fromStateId: PENDING_STATE_ID,
    id: START_ACTION_ID,
    name: "开始处理",
    order: 0,
    requiresComment: false,
    toState: state("IN_PROGRESS", IN_PROGRESS_STATE_ID, "IN_PROGRESS"),
    toStateId: IN_PROGRESS_STATE_ID,
    workflowVersionId: WORKFLOW_VERSION_ID,
    ...overrides,
  };
}

function state(
  code: string,
  id: string,
  category: ExecutableWorkflowAction["toState"]["category"],
  isEnd = false,
) {
  return {
    category,
    code,
    id,
    isEnd,
  };
}

function makeField(
  overrides: Partial<ExecutableWorkflowActionFormField> = {},
): ExecutableWorkflowActionFormField {
  return {
    fieldType: "TEXTAREA",
    id: FIELD_ID,
    key: "reason",
    label: "原因",
    options: [],
    order: 0,
    required: false,
    ...overrides,
  };
}

function hasOwn<TObject extends object, TKey extends PropertyKey>(
  object: TObject,
  key: TKey,
): object is TObject & Record<TKey, unknown> {
  return Object.prototype.hasOwnProperty.call(object, key);
}
