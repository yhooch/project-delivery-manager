import { describe, expect, it, vi } from "vitest";

import type {
  BugView,
  OrganizationMemberWithUser,
  Space,
  SpaceMemberWithUser,
  SpaceRole,
} from "@project-delivery/shared";
import type { OrganizationRepository } from "../organization/organization.repository";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { SpaceRepository } from "../space/space.repository";
import type { SpaceAccess } from "../space/space.types";
import type { WorkflowActionExecutionService } from "../workflow/workflow-action-execution.service";
import { BugService } from "./bug.service";
import type { BugRepository } from "./bug.repository";
import type {
  BugLinkedUsers,
  BugListInput,
  BugWorkflowSelection,
  CreateAuditLogInput,
  CreateBugInput,
  UpdateBugInput,
} from "./bug.types";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const VIEWER_ID = "01H00000000000000000000003";
const ASSIGNEE_ID = "01H00000000000000000000004";
const VERSION_ID = "01H00000000000000000000005";
const REQUIREMENT_ID = "01H00000000000000000000006";
const INTAKE_ITEM_ID = "01H00000000000000000000007";
const WORKFLOW_VERSION_ID = "01H00000000000000000000008";
const CURRENT_STATE_ID = "01H00000000000000000000009";
const BUG_ID = "01H0000000000000000000000A";
const RELATED_TASK_ID = "01H0000000000000000000000B";
const RELATED_USER_ID = "01H0000000000000000000000C";
const VERSION_TWO_ID = "01H0000000000000000000000D";
const EXPLICIT_WORKFLOW_VERSION_ID = "01H0000000000000000000000E";
const EXPLICIT_CURRENT_STATE_ID = "01H0000000000000000000000F";

describe("BugService", () => {
  it("creates BUG work items with bug_details, default workflow and participants", async () => {
    const subject = createSubject("TESTER");

    subject.bugs.workflowSelection = {
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    };
    subject.bugs.versionRefs.set(VERSION_ID, {
      versionOwnerId: RELATED_USER_ID,
    });
    subject.bugs.requirementRefs.set(REQUIREMENT_ID, {
      requirementOwnerId: RELATED_USER_ID,
    });
    subject.bugs.intakeRefs.set(INTAKE_ITEM_ID, {
      intakeAssigneeId: ASSIGNEE_ID,
      intakeReporterId: ACTOR_ID,
    });
    subject.bugs.relatedTaskRefs.set(RELATED_TASK_ID, {
      relatedTaskAssigneeId: ASSIGNEE_ID,
      relatedTaskCreatorId: RELATED_USER_ID,
      relatedTaskReporterId: ACTOR_ID,
    });
    subject.spaces.addMember(ASSIGNEE_ID, "DEVELOPER");
    subject.organizations.addMember(ASSIGNEE_ID);

    const created = await subject.service.create(
      ACTOR_ID,
      SPACE_ID,
      {
        actualResult: "500",
        assigneeId: ASSIGNEE_ID,
        expectedResult: "200",
        intakeItemId: INTAKE_ITEM_ID,
        priority: "HIGH",
        relatedTaskId: RELATED_TASK_ID,
        requirementId: REQUIREMENT_ID,
        severity: "CRITICAL",
        stepsToReproduce: "Submit login form",
        title: "Login regression",
        versionId: VERSION_ID,
      },
      {
        requestId: "create-request",
      },
    );

    expect(created).toMatchObject({
      currentStateId: CURRENT_STATE_ID,
      permissions: {
        availableActions: [
          {
            code: "START_PROGRESS",
          },
        ],
      },
      priority: "HIGH",
      statusCategory: "NOT_STARTED",
      type: "BUG",
      workflowVersionId: WORKFLOW_VERSION_ID,
      bugDetail: {
        actualResult: "500",
        expectedResult: "200",
        relatedTaskId: RELATED_TASK_ID,
        severity: "CRITICAL",
        stepsToReproduce: "Submit login form",
      },
    });
    expect(created.bugDetail.workItemId).toBe(created.id);
    expect(subject.bugs.createdInput).toMatchObject({
      currentStateId: CURRENT_STATE_ID,
      organizationId: ORGANIZATION_ID,
      reporterId: ACTOR_ID,
      severity: "CRITICAL",
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    });
    expect(subject.bugs.createdInput?.relatedUserIds.sort()).toEqual([
      ACTOR_ID,
      ASSIGNEE_ID,
      RELATED_USER_ID,
    ]);
    expect(subject.permissionResolver.resolvedWorkItemIds).toEqual([
      created.id,
    ]);
    expect(subject.bugs.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "CREATE",
          metadata: {
            operation: "createBug",
            workItemType: "BUG",
          },
          requestId: "create-request",
          targetType: "WORK_ITEM",
        }),
      ]),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "CREATED",
        target: { type: "WORK_ITEM", id: created.id },
        invalidates: expect.arrayContaining([
          "bug-list",
          "version-board",
          "timeline",
        ]),
        hints: expect.objectContaining({
          relatedTargetId: RELATED_TASK_ID,
          relatedTargetType: "WORK_ITEM",
          targetType: "WORK_ITEM",
          versionId: VERSION_ID,
          workItemType: "BUG",
        }),
      }),
    );
  });

  it("uses an explicit workflow version when creating BUG work items", async () => {
    const subject = createSubject("TESTER");

    subject.bugs.workflowSelection = {
      currentStateId: EXPLICIT_CURRENT_STATE_ID,
      statusCategory: "IN_PROGRESS",
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    };

    const created = await subject.service.create(ACTOR_ID, SPACE_ID, {
      priority: "MEDIUM",
      severity: "MAJOR",
      title: "Explicit workflow bug",
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    });

    expect(subject.bugs.workflowSelectionInput).toEqual({
      spaceId: SPACE_ID,
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    });
    expect(created).toMatchObject({
      currentStateId: EXPLICIT_CURRENT_STATE_ID,
      statusCategory: "IN_PROGRESS",
      type: "BUG",
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    });
    expect(subject.bugs.createdInput).toMatchObject({
      currentStateId: EXPLICIT_CURRENT_STATE_ID,
      statusCategory: "IN_PROGRESS",
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    });
  });

  it("returns permissions with BUG detail so edit entry points are reachable", async () => {
    const subject = createSubject("PM");

    subject.bugs.items.set(BUG_ID, makeBug());

    await expect(subject.service.get(ACTOR_ID, BUG_ID)).resolves.toMatchObject({
      id: BUG_ID,
      permissions: {
        availableActions: [
          {
            code: "START_PROGRESS",
          },
        ],
        canEdit: true,
      },
    });
    expect(subject.permissionResolver.resolvedWorkItemIds).toEqual([BUG_ID]);
  });

  it("uses space-wide visibility for TESTER and participant visibility for developers", async () => {
    const testerSubject = createSubject("TESTER");

    await testerSubject.service.list(ACTOR_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(testerSubject.bugs.listInput?.visibility).toBe("SPACE");

    const developerSubject = createSubject("DEVELOPER");

    await developerSubject.service.list(ACTOR_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(developerSubject.bugs.listInput?.visibility).toBe("PARTICIPANT");
  });

  it.each(["DEVELOPER", "MEMBER", "VIEWER"] as const)(
    "rejects %s BUG creates and records an access denied audit log",
    async (role) => {
      const actorUserId = role === "VIEWER" ? VIEWER_ID : ACTOR_ID;
      const subject = createSubject(role, actorUserId);

      await expect(
        subject.service.create(
          actorUserId,
          SPACE_ID,
          {
            priority: "MEDIUM",
            severity: "MAJOR",
            title: `${role} write`,
          },
          {
            requestId: `${role.toLowerCase()}-denied`,
          },
        ),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });

      expect(subject.bugs.auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionType: "ACCESS_DENIED",
            metadata: expect.objectContaining({
              operation: "createBug",
            }),
            requestId: `${role.toLowerCase()}-denied`,
            targetId: SPACE_ID,
            targetType: "SPACE",
          }),
        ]),
      );
    },
  );

  it("rejects relatedTaskId when the task is missing, a Bug or from another space", async () => {
    const subject = createSubject("TESTER");

    subject.bugs.workflowSelection = {
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    };

    await expect(
      subject.service.create(ACTOR_ID, SPACE_ID, {
        priority: "MEDIUM",
        relatedTaskId: RELATED_TASK_ID,
        severity: "MAJOR",
        title: "bad relation",
      }),
    ).rejects.toMatchObject({
      code: "WORK_ITEM_NOT_FOUND",
    });
  });

  it("inherits related task version when creating a BUG and rejects version conflicts", async () => {
    const subject = createSubject("TESTER");

    subject.bugs.workflowSelection = {
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    };
    subject.bugs.versionRefs.set(VERSION_ID, {});
    subject.bugs.versionRefs.set(VERSION_TWO_ID, {});
    subject.bugs.relatedTaskRefs.set(RELATED_TASK_ID, {
      relatedTaskVersionId: VERSION_ID,
    });

    const created = await subject.service.create(ACTOR_ID, SPACE_ID, {
      priority: "MEDIUM",
      relatedTaskId: RELATED_TASK_ID,
      severity: "MAJOR",
      title: "Inherited task bug",
    });

    expect(created.versionId).toBe(VERSION_ID);
    expect(subject.bugs.createdInput?.versionId).toBe(VERSION_ID);

    await expect(
      subject.service.create(ACTOR_ID, SPACE_ID, {
        priority: "MEDIUM",
        relatedTaskId: RELATED_TASK_ID,
        severity: "MAJOR",
        title: "Conflicting task bug",
        versionId: VERSION_TWO_ID,
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CONFLICT",
    });
  });

  it("updates bug details, related participants and assignee change timeline input", async () => {
    const subject = createSubject("PM");

    subject.bugs.items.set(
      BUG_ID,
      makeBug({
        assigneeId: ACTOR_ID,
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
        bugDetail: {
          workItemId: BUG_ID,
          severity: "MAJOR",
        },
      }),
    );
    subject.bugs.participantKeys.add(`${BUG_ID}:${ACTOR_ID}`);
    subject.bugs.versionRefs.set(VERSION_ID, {
      versionOwnerId: RELATED_USER_ID,
    });
    subject.bugs.requirementRefs.set(REQUIREMENT_ID, {
      requirementOwnerId: RELATED_USER_ID,
    });
    subject.bugs.relatedTaskRefs.set(RELATED_TASK_ID, {
      relatedTaskAssigneeId: ASSIGNEE_ID,
      relatedTaskCreatorId: RELATED_USER_ID,
      relatedTaskReporterId: ACTOR_ID,
    });
    subject.spaces.addMember(ASSIGNEE_ID, "DEVELOPER");
    subject.organizations.addMember(ASSIGNEE_ID);

    const updated = await subject.service.update(
      ACTOR_ID,
      BUG_ID,
      {
        assigneeId: ASSIGNEE_ID,
        relatedTaskId: RELATED_TASK_ID,
        severity: "CRITICAL",
      },
      {
        requestId: "update-request",
      },
    );

    expect(updated).toMatchObject({
      assigneeId: ASSIGNEE_ID,
      bugDetail: {
        relatedTaskId: RELATED_TASK_ID,
        severity: "CRITICAL",
      },
      permissions: {
        availableActions: [
          {
            code: "START_PROGRESS",
          },
        ],
      },
    });
    expect(subject.bugs.updatedInput).toMatchObject({
      assigneeChanged: true,
      assigneeId: ASSIGNEE_ID,
      relatedTaskId: RELATED_TASK_ID,
      severity: "CRITICAL",
      shouldReplaceAssigneeParticipants: true,
      shouldReplaceRelatedParticipants: true,
    });
    expect(subject.bugs.updatedInput?.timelineAfter).toMatchObject({
      assigneeId: ASSIGNEE_ID,
      relatedTaskId: RELATED_TASK_ID,
      severity: "CRITICAL",
    });
    expect(subject.bugs.updatedInput?.relatedUserIds.sort()).toEqual([
      ACTOR_ID,
      ASSIGNEE_ID,
      RELATED_USER_ID,
    ]);
    expect(subject.permissionResolver.resolvedWorkItemIds).toEqual([BUG_ID]);
    expect(subject.bugs.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "UPDATE",
          metadata: {
            operation: "updateBug",
            workItemType: "BUG",
          },
          requestId: "update-request",
          targetId: BUG_ID,
          targetType: "WORK_ITEM",
        }),
      ]),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "UPDATED",
        target: { type: "WORK_ITEM", id: BUG_ID },
        invalidates: expect.arrayContaining([
          "bug-list",
          "version-board",
          "timeline",
        ]),
        hints: expect.objectContaining({
          changedFields: expect.arrayContaining([
            "assigneeId",
            "relatedTaskId",
            "severity",
          ]),
          relatedTargetId: RELATED_TASK_ID,
          workItemType: "BUG",
        }),
      }),
    );
  });

  it("does not map lifecycle fields through direct BUG patch updates", async () => {
    const subject = createSubject("PM");

    subject.bugs.items.set(
      BUG_ID,
      makeBug({
        bugDetail: {
          fixNote: "Existing fix note",
          regressionAt: "2026-05-13T00:00:00.000Z",
          regressionBy: RELATED_USER_ID,
          regressionResult: "Existing regression",
          severity: "MAJOR",
          workItemId: BUG_ID,
        },
      }),
    );

    const updated = await subject.service.update(ACTOR_ID, BUG_ID, {
      fixNote: "Injected fix note",
      regressionAt: "2026-05-14T00:00:00.000Z",
      regressionBy: ACTOR_ID,
      regressionResult: "Injected regression",
      severity: "CRITICAL",
    } as unknown as Parameters<BugService["update"]>[2]);
    const updateRecord = subject.bugs.updatedInput as unknown as Record<
      string,
      unknown
    >;

    expect(updated.bugDetail).toMatchObject({
      fixNote: "Existing fix note",
      regressionAt: "2026-05-13T00:00:00.000Z",
      regressionBy: RELATED_USER_ID,
      regressionResult: "Existing regression",
      severity: "CRITICAL",
    });
    expect(updateRecord.fixNote).toBeUndefined();
    expect(updateRecord.regressionAt).toBeUndefined();
    expect(updateRecord.regressionById).toBeUndefined();
    expect(updateRecord.regressionResult).toBeUndefined();
    expect(subject.bugs.updatedInput?.timelineAfter).toEqual({
      severity: "CRITICAL",
    });
  });

  it("clears optional bug links and dates when update fields are null", async () => {
    const subject = createSubject("PM");

    subject.bugs.items.set(
      BUG_ID,
      makeBug({
        assigneeId: ASSIGNEE_ID,
        description: "Old description",
        dueDate: "2026-05-20T00:00:00.000Z",
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
        bugDetail: {
          actualResult: "Old actual",
          expectedResult: "Old expected",
          relatedTaskId: RELATED_TASK_ID,
          severity: "MAJOR",
          stepsToReproduce: "Old steps",
          workItemId: BUG_ID,
        },
      }),
    );

    const updated = await subject.service.update(ACTOR_ID, BUG_ID, {
      actualResult: null,
      assigneeId: null,
      description: null,
      dueDate: null,
      expectedResult: null,
      relatedTaskId: null,
      requirementId: null,
      stepsToReproduce: null,
      versionId: null,
    });

    expect(updated.assigneeId).toBeUndefined();
    expect(updated.description).toBeUndefined();
    expect(updated.dueDate).toBeUndefined();
    expect(updated.requirementId).toBeUndefined();
    expect(updated.versionId).toBeUndefined();
    expect(updated.bugDetail.actualResult).toBeUndefined();
    expect(updated.bugDetail.expectedResult).toBeUndefined();
    expect(updated.bugDetail.relatedTaskId).toBeUndefined();
    expect(updated.bugDetail.stepsToReproduce).toBeUndefined();
    expect(subject.bugs.updatedInput).toMatchObject({
      assigneeChanged: true,
      assigneeId: null,
      dueDate: null,
      relatedTaskId: null,
      relatedUserIds: [],
      requirementId: null,
      shouldReplaceAssigneeParticipants: true,
      shouldReplaceRelatedParticipants: true,
      versionId: null,
    });
    expect(subject.bugs.updatedInput?.timelineAfter).toMatchObject({
      actualResult: null,
      assigneeId: null,
      description: null,
      dueDate: null,
      expectedResult: null,
      relatedTaskId: null,
      requirementId: null,
      stepsToReproduce: null,
      versionId: null,
    });
  });

  it("allows independent BUG version edits without upstream links", async () => {
    const subject = createSubject("PM");

    subject.bugs.items.set(BUG_ID, makeBug());
    subject.bugs.versionRefs.set(VERSION_TWO_ID, {});

    const updated = await subject.service.update(ACTOR_ID, BUG_ID, {
      versionId: VERSION_TWO_ID,
    });

    expect(updated.versionId).toBe(VERSION_TWO_ID);
    expect(subject.bugs.updatedInput?.versionId).toBe(VERSION_TWO_ID);
  });

  it("inherits intake version when relinking a BUG intake item", async () => {
    const subject = createSubject("PM");

    subject.bugs.items.set(BUG_ID, makeBug());
    subject.bugs.versionRefs.set(VERSION_ID, {});
    subject.bugs.intakeRefs.set(INTAKE_ITEM_ID, {
      intakeVersionId: VERSION_ID,
    });

    const updated = await subject.service.update(ACTOR_ID, BUG_ID, {
      intakeItemId: INTAKE_ITEM_ID,
    });

    expect(updated.intakeItemId).toBe(INTAKE_ITEM_ID);
    expect(updated.versionId).toBe(VERSION_ID);
    expect(subject.bugs.updatedInput).toMatchObject({
      intakeItemId: INTAKE_ITEM_ID,
      versionId: VERSION_ID,
    });
  });

  it("inherits requirement version when relinking a BUG requirement", async () => {
    const subject = createSubject("PM");

    subject.bugs.items.set(BUG_ID, makeBug());
    subject.bugs.versionRefs.set(VERSION_ID, {});
    subject.bugs.requirementRefs.set(REQUIREMENT_ID, {
      requirementVersionId: VERSION_ID,
    });

    const updated = await subject.service.update(ACTOR_ID, BUG_ID, {
      requirementId: REQUIREMENT_ID,
    });

    expect(updated.requirementId).toBe(REQUIREMENT_ID);
    expect(updated.versionId).toBe(VERSION_ID);
    expect(subject.bugs.updatedInput).toMatchObject({
      requirementId: REQUIREMENT_ID,
      versionId: VERSION_ID,
    });
  });

  it.each(["DEVELOPER", "TESTER", "MEMBER"] as const)(
    "rejects %s direct BUG patches even when the bug is visible",
    async (role) => {
      const subject = createSubject(role);

      subject.bugs.items.set(
        BUG_ID,
        makeBug({
          assigneeId: ACTOR_ID,
        }),
      );
      subject.bugs.participantKeys.add(`${BUG_ID}:${ACTOR_ID}`);

      await expect(
        subject.service.update(
          ACTOR_ID,
          BUG_ID,
          {
            severity: "CRITICAL",
            title: `${role} direct edit`,
          },
          {
            requestId: `${role.toLowerCase()}-patch-denied`,
          },
        ),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });

      expect(subject.bugs.updatedInput).toBeUndefined();
      expect(subject.bugs.auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionType: "ACCESS_DENIED",
            metadata: expect.objectContaining({
              operation: "updateBug",
              workItemType: "BUG",
            }),
            requestId: `${role.toLowerCase()}-patch-denied`,
            targetId: BUG_ID,
            targetType: "WORK_ITEM",
          }),
        ]),
      );
    },
  );
});

function createSubject(role: SpaceRole, actorUserId = ACTOR_ID) {
  const bugs = new FakeBugRepository();
  const spaces = new FakeSpaceRepository();
  const organizations = new FakeOrganizationRepository();
  const permissionResolver = createPermissionResolver(role);
  const realtime = createRealtimePublisher();

  spaces.addAccess(actorUserId, role);
  spaces.addMember(actorUserId, role);
  organizations.addMember(actorUserId);

  return {
    bugs,
    organizations,
    realtime,
    service: new BugService(
      bugs,
      spaces as unknown as SpaceRepository,
      organizations as unknown as OrganizationRepository,
      permissionResolver as unknown as WorkflowActionExecutionService,
      realtime,
    ),
    permissionResolver,
    spaces,
  };
}

function createRealtimePublisher() {
  return {
    publish: vi.fn(),
  } as unknown as RealtimePublisherService & {
    publish: ReturnType<typeof vi.fn>;
  };
}

function createPermissionResolver(role: SpaceRole) {
  const canAct = role !== "VIEWER";
  const canDirectEdit = role === "SPACE_ADMIN" || role === "PM";

  return {
    resolvedWorkItemIds: [] as string[],
    async resolvePermissionSnapshot(_actorUserId: string, workItemId: string) {
      this.resolvedWorkItemIds.push(workItemId);
      return {
        availableActions: [
          {
            code: "START_PROGRESS",
            formFields: [],
            fromStateId: CURRENT_STATE_ID,
            id: "01H0000000000000000000000D",
            name: "开始处理",
            order: 0,
            requiresComment: false,
            toStateId: "01H0000000000000000000000E",
          },
        ],
        canComment: canAct,
        canEdit: canDirectEdit,
        canUploadAttachment: canAct,
      };
    },
    async resolvePermissionSnapshotForKnownVisibleWorkItem(
      _actorUserId: string,
      workItemId: string,
    ) {
      this.resolvedWorkItemIds.push(workItemId);
      return {
        availableActions: [
          {
            code: "START_PROGRESS",
            formFields: [],
            fromStateId: CURRENT_STATE_ID,
            id: "01H0000000000000000000000D",
            name: "开始处理",
            order: 0,
            requiresComment: false,
            toStateId: "01H0000000000000000000000E",
          },
        ],
        canComment: canAct,
        canEdit: canDirectEdit,
        canUploadAttachment: canAct,
      };
    },
  };
}

class FakeBugRepository implements BugRepository {
  createdInput?: CreateBugInput;
  updatedInput?: UpdateBugInput;
  listInput?: BugListInput;
  workflowSelectionInput?: {
    spaceId: string;
    workflowVersionId?: string;
  };
  workflowSelection?: BugWorkflowSelection;
  readonly auditLogs: CreateAuditLogInput[] = [];
  readonly items = new Map<string, BugView>();
  readonly participantKeys = new Set<string>();
  readonly versionRefs = new Map<string, BugLinkedUsers>();
  readonly requirementRefs = new Map<string, BugLinkedUsers>();
  readonly intakeRefs = new Map<string, BugLinkedUsers>();
  readonly relatedTaskRefs = new Map<string, BugLinkedUsers>();

  async create(input: CreateBugInput) {
    this.createdInput = input;
    const item = makeBug({
      assigneeId: input.assigneeId,
      currentStateId: input.currentStateId,
      description: input.description,
      dueDate: input.dueDate?.toISOString(),
      id: input.id,
      intakeItemId: input.intakeItemId,
      lastStatusChangedAt: input.lastStatusChangedAt.toISOString(),
      priority: input.priority,
      reporterId: input.reporterId,
      requirementId: input.requirementId,
      statusCategory: input.statusCategory,
      title: input.title,
      versionId: input.versionId,
      workflowVersionId: input.workflowVersionId,
      bugDetail: {
        actualResult: input.actualResult,
        expectedResult: input.expectedResult,
        relatedTaskId: input.relatedTaskId,
        severity: input.severity,
        stepsToReproduce: input.stepsToReproduce,
        workItemId: input.id,
      },
    });

    this.items.set(item.id, item);
    return item;
  }

  async createAuditLog(input: CreateAuditLogInput) {
    this.auditLogs.push(input);
  }

  async findBugById(bugId: string) {
    return this.items.get(bugId);
  }

  async findSpaceAuditContext(spaceId: string) {
    return {
      organizationId: ORGANIZATION_ID,
      spaceId,
    };
  }

  async findVersionInSpace(_spaceId: string, versionId: string) {
    return this.versionRefs.get(versionId);
  }

  async findRequirementInSpace(_spaceId: string, requirementId: string) {
    return this.requirementRefs.get(requirementId);
  }

  async findIntakeItemInSpace(_spaceId: string, intakeItemId: string) {
    return this.intakeRefs.get(intakeItemId);
  }

  async findRelatedTaskInSpace(_spaceId: string, relatedTaskId: string) {
    return this.relatedTaskRefs.get(relatedTaskId);
  }

  async isParticipant(_spaceId: string, bugId: string, userId: string) {
    return this.participantKeys.has(`${bugId}:${userId}`);
  }

  async listBySpaceId(_spaceId: string, input: BugListInput) {
    this.listInput = input;
    return {
      items: [],
      page: input.page,
      pageSize: input.pageSize,
      total: 0,
    };
  }

  async resolveBugWorkflow(spaceId: string, workflowVersionId?: string) {
    this.workflowSelectionInput = { spaceId, workflowVersionId };
    return this.workflowSelection;
  }

  async update(input: UpdateBugInput) {
    this.updatedInput = input;
    const existing = this.items.get(input.workItemId);

    if (!existing) {
      return undefined;
    }

    const updated = makeBug({
      ...existing,
      assigneeId: applyOptional(input.assigneeId, existing.assigneeId),
      bugDetail: {
        ...existing.bugDetail,
        actualResult: applyOptional(
          input.actualResult,
          existing.bugDetail.actualResult,
        ),
        expectedResult: applyOptional(
          input.expectedResult,
          existing.bugDetail.expectedResult,
        ),
        relatedTaskId: applyOptional(
          input.relatedTaskId,
          existing.bugDetail.relatedTaskId,
        ),
        severity: input.severity ?? existing.bugDetail.severity,
        stepsToReproduce: applyOptional(
          input.stepsToReproduce,
          existing.bugDetail.stepsToReproduce,
        ),
      },
      description: applyOptional(input.description, existing.description),
      dueDate: applyOptionalDate(input.dueDate, existing.dueDate),
      intakeItemId: applyOptional(input.intakeItemId, existing.intakeItemId),
      priority: input.priority ?? existing.priority,
      requirementId: applyOptional(input.requirementId, existing.requirementId),
      title: input.title ?? existing.title,
      versionId: applyOptional(input.versionId, existing.versionId),
    });

    this.items.set(updated.id, updated);
    return updated;
  }
}

class FakeSpaceRepository {
  readonly access = new Map<string, SpaceAccess>();
  readonly members = new Map<string, SpaceMemberWithUser>();

  addAccess(userId: string, role: SpaceRole) {
    this.access.set(`${userId}:${SPACE_ID}`, {
      role,
      space: makeSpace(),
    });
  }

  addMember(userId: string, role: SpaceRole) {
    this.members.set(`${SPACE_ID}:${userId}`, {
      id: `${userId.slice(0, 25)}M`,
      organizationId: ORGANIZATION_ID,
      role,
      spaceId: SPACE_ID,
      status: "ACTIVE",
      user: {
        id: userId,
        name: userId,
        status: "ACTIVE",
        username: userId.toLowerCase(),
      },
      userId,
    });
  }

  async findAccessibleById(userId: string, spaceId: string) {
    return this.access.get(`${userId}:${spaceId}`);
  }

  async findMemberByUserId(spaceId: string, userId: string) {
    return this.members.get(`${spaceId}:${userId}`);
  }
}

class FakeOrganizationRepository {
  readonly members = new Map<string, OrganizationMemberWithUser>();

  addMember(userId: string) {
    this.members.set(`${ORGANIZATION_ID}:${userId}`, {
      id: `${userId.slice(0, 25)}O`,
      organizationId: ORGANIZATION_ID,
      role: "MEMBER",
      status: "ACTIVE",
      user: {
        id: userId,
        name: userId,
        status: "ACTIVE",
        username: userId.toLowerCase(),
      },
      userId,
    });
  }

  async findMemberByUserId(organizationId: string, userId: string) {
    return this.members.get(`${organizationId}:${userId}`);
  }
}

function applyOptional<T>(
  value: T | null | undefined,
  fallback: T | undefined,
) {
  if (value === undefined) {
    return fallback;
  }

  return value === null ? undefined : value;
}

function applyOptionalDate(
  value: Date | null | undefined,
  fallback: string | undefined,
) {
  if (value === undefined) {
    return fallback;
  }

  return value === null ? undefined : value.toISOString();
}

function makeSpace(): Space {
  return {
    code: "TEST",
    id: SPACE_ID,
    name: "Test Space",
    organizationId: ORGANIZATION_ID,
    status: "ACTIVE",
    settings: {
      staleThresholdDays: 3,
    },
  };
}

function makeBug(overrides: Partial<BugView> = {}): BugView {
  const id = overrides.id ?? BUG_ID;

  return {
    currentStateId: CURRENT_STATE_ID,
    id,
    lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    priority: "MEDIUM",
    reporterId: ACTOR_ID,
    spaceId: SPACE_ID,
    statusCategory: "NOT_STARTED",
    title: "Existing bug",
    type: "BUG",
    workflowVersionId: WORKFLOW_VERSION_ID,
    ...overrides,
    tags: overrides.tags ?? [],
    bugDetail: {
      workItemId: id,
      severity: "MAJOR",
      ...overrides.bugDetail,
    },
  };
}
