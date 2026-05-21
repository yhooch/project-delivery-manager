import { describe, expect, it, vi } from "vitest";

import type {
  OrganizationMemberWithUser,
  Space,
  SpaceMemberWithUser,
  SpaceRole,
  WorkItem,
} from "@project-delivery/shared";
import type { AuditService } from "../audit/audit.service";
import type { OrganizationRepository } from "../organization/organization.repository";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { SpaceRepository } from "../space/space.repository";
import type { SpaceAccess } from "../space/space.types";
import type { WorkflowActionExecutionService } from "../workflow/workflow-action-execution.service";
import { WorkItemService } from "./workitem.service";
import type { WorkItemRepository } from "./workitem.repository";
import type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemLinkedUsers,
  WorkItemListInput,
  WorkItemWorkflowSelection,
} from "./workitem.types";

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
const WORK_ITEM_ID = "01H0000000000000000000000A";
const RELATED_USER_ID = "01H0000000000000000000000B";
const VERSION_TWO_ID = "01H0000000000000000000000C";
const BUG_ID = "01H0000000000000000000000D";
const EXPLICIT_WORKFLOW_VERSION_ID = "01H0000000000000000000000E";
const EXPLICIT_CURRENT_STATE_ID = "01H0000000000000000000000F";

describe("WorkItemService", () => {
  it("creates TASK work items with the default workflow start state and participants", async () => {
    const subject = createSubject("PM");

    subject.workItems.workflowSelection = {
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    };
    subject.workItems.versionRefs.set(VERSION_ID, {
      versionOwnerId: RELATED_USER_ID,
    });
    subject.workItems.requirementRefs.set(REQUIREMENT_ID, {
      requirementOwnerId: RELATED_USER_ID,
    });
    subject.workItems.intakeRefs.set(INTAKE_ITEM_ID, {
      intakeAssigneeId: ASSIGNEE_ID,
      intakeReporterId: ACTOR_ID,
    });
    subject.spaces.addMember(ASSIGNEE_ID, "DEVELOPER");
    subject.organizations.addMember(ASSIGNEE_ID);

    const created = await subject.service.create(
      ACTOR_ID,
      SPACE_ID,
      {
        assigneeId: ASSIGNEE_ID,
        dueDate: "2026-06-01T00:00:00.000Z",
        intakeItemId: INTAKE_ITEM_ID,
        priority: "HIGH",
        requirementId: REQUIREMENT_ID,
        title: "Implement task API",
        type: "TASK",
        versionId: VERSION_ID,
      },
      { requestId: "req-workitem-create" },
    );

    expect(created).toMatchObject({
      assigneeId: ASSIGNEE_ID,
      currentStateId: CURRENT_STATE_ID,
      dueDate: "2026-06-01T00:00:00.000Z",
      reporterId: ACTOR_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    });
    expect(subject.workItems.createdInput).toMatchObject({
      assigneeId: ASSIGNEE_ID,
      currentStateId: CURRENT_STATE_ID,
      organizationId: ORGANIZATION_ID,
      reporterId: ACTOR_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    });
    expect(subject.workItems.createdInput?.relatedUserIds.sort()).toEqual([
      ACTOR_ID,
      ASSIGNEE_ID,
      RELATED_USER_ID,
    ]);
    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: ACTOR_ID,
        after: expect.objectContaining({ id: created.id }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-workitem-create",
        spaceId: SPACE_ID,
        targetId: created.id,
        targetType: "WORK_ITEM",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "CREATED",
        target: { type: "WORK_ITEM", id: created.id },
        invalidates: expect.arrayContaining([
          "work-item-list",
          "version-board",
          "timeline",
        ]),
        hints: expect.objectContaining({
          intakeItemId: INTAKE_ITEM_ID,
          requirementId: REQUIREMENT_ID,
          targetId: created.id,
          targetType: "WORK_ITEM",
          versionId: VERSION_ID,
          workItemType: "TASK",
        }),
      }),
    );
  });

  it("allows SPACE_ADMIN users to create TASK work items", async () => {
    const subject = createSubject("SPACE_ADMIN");

    subject.workItems.workflowSelection = {
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    };

    await expect(
      subject.service.create(ACTOR_ID, SPACE_ID, {
        priority: "MEDIUM",
        title: "admin task",
        type: "TASK",
      }),
    ).resolves.toMatchObject({
      reporterId: ACTOR_ID,
      title: "admin task",
      type: "TASK",
    });
    expect(subject.workItems.createdInput).toMatchObject({
      createdById: ACTOR_ID,
      reporterId: ACTOR_ID,
      spaceId: SPACE_ID,
    });
  });

  it("uses an explicit workflow version when creating TASK work items", async () => {
    const subject = createSubject("PM");

    subject.workItems.workflowSelection = {
      currentStateId: EXPLICIT_CURRENT_STATE_ID,
      statusCategory: "IN_PROGRESS",
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    };

    const created = await subject.service.create(ACTOR_ID, SPACE_ID, {
      priority: "MEDIUM",
      title: "Explicit workflow task",
      type: "TASK",
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    });

    expect(subject.workItems.workflowSelectionInput).toEqual({
      spaceId: SPACE_ID,
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    });
    expect(created).toMatchObject({
      currentStateId: EXPLICIT_CURRENT_STATE_ID,
      statusCategory: "IN_PROGRESS",
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    });
    expect(subject.workItems.createdInput).toMatchObject({
      currentStateId: EXPLICIT_CURRENT_STATE_ID,
      statusCategory: "IN_PROGRESS",
      workflowVersionId: EXPLICIT_WORKFLOW_VERSION_ID,
    });
  });

  it("inherits a versioned requirement when creating a TASK and rejects explicit mismatches", async () => {
    const subject = createSubject("PM");

    subject.workItems.workflowSelection = {
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    };
    subject.workItems.versionRefs.set(VERSION_ID, {});
    subject.workItems.versionRefs.set(VERSION_TWO_ID, {});
    subject.workItems.requirementRefs.set(REQUIREMENT_ID, {
      requirementVersionId: VERSION_ID,
    });

    const created = await subject.service.create(ACTOR_ID, SPACE_ID, {
      priority: "MEDIUM",
      requirementId: REQUIREMENT_ID,
      title: "Inherited version task",
      type: "TASK",
    });

    expect(created.versionId).toBe(VERSION_ID);
    expect(subject.workItems.createdInput?.versionId).toBe(VERSION_ID);

    await expect(
      subject.service.create(ACTOR_ID, SPACE_ID, {
        priority: "MEDIUM",
        requirementId: REQUIREMENT_ID,
        title: "Wrong version task",
        type: "TASK",
        versionId: VERSION_TWO_ID,
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CONFLICT",
    });
  });

  it("uses scoped visibility for TESTER and participant visibility for other roles", async () => {
    const pmSubject = createSubject("PM");

    await pmSubject.service.list(ACTOR_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(pmSubject.workItems.listInput?.visibility).toBe("SPACE");

    const testerSubject = createSubject("TESTER");

    await testerSubject.service.list(ACTOR_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(testerSubject.workItems.listInput?.visibility).toBe("TESTER");

    const developerSubject = createSubject("DEVELOPER");

    await developerSubject.service.list(ACTOR_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(developerSubject.workItems.listInput?.visibility).toBe(
      "PARTICIPANT",
    );
  });

  it("hides non-testing TASK details from non-participant TESTER users", async () => {
    const subject = createSubject("TESTER");
    subject.workItems.items.set(WORK_ITEM_ID, makeWorkItem());

    await expect(
      subject.service.get(ACTOR_ID, WORK_ITEM_ID),
    ).rejects.toMatchObject({
      code: "WORK_ITEM_NOT_FOUND",
    });

    subject.workItems.testerVisibleIds.add(WORK_ITEM_ID);

    await expect(
      subject.service.get(ACTOR_ID, WORK_ITEM_ID),
    ).resolves.toMatchObject({
      id: WORK_ITEM_ID,
    });
  });

  it("returns read-only permissions for VIEWER details", async () => {
    const subject = createSubject("VIEWER", VIEWER_ID);
    subject.workItems.items.set(WORK_ITEM_ID, makeWorkItem());

    const detail = await subject.service.get(VIEWER_ID, WORK_ITEM_ID);

    expect(detail.permissions).toEqual({
      availableActions: [],
      canComment: false,
      canEdit: false,
      canUploadAttachment: false,
    });
  });

  it("rejects VIEWER writes", async () => {
    const subject = createSubject("VIEWER", VIEWER_ID);

    await expect(
      subject.service.create(VIEWER_ID, SPACE_ID, {
        priority: "MEDIUM",
        title: "viewer write",
        type: "TASK",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
    });
  });

  it.each(["DEVELOPER", "TESTER", "MEMBER"] as const)(
    "rejects %s direct TASK creation",
    async (role) => {
      const subject = createSubject(role);

      subject.workItems.workflowSelection = {
        currentStateId: CURRENT_STATE_ID,
        statusCategory: "NOT_STARTED",
        workflowVersionId: WORKFLOW_VERSION_ID,
      };

      await expect(
        subject.service.create(ACTOR_ID, SPACE_ID, {
          priority: "MEDIUM",
          title: `${role} task`,
          type: "TASK",
        }),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });
      expect(subject.workItems.createdInput).toBeUndefined();
    },
  );

  it("updates editable fields without changing workflow state fields", async () => {
    const subject = createSubject("PM");
    subject.workItems.items.set(
      WORK_ITEM_ID,
      makeWorkItem({
        assigneeId: ACTOR_ID,
        intakeItemId: INTAKE_ITEM_ID,
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
      }),
    );
    subject.workItems.participantKeys.add(`${WORK_ITEM_ID}:${ACTOR_ID}`);
    subject.workItems.versionRefs.set(VERSION_ID, {
      versionOwnerId: RELATED_USER_ID,
    });
    subject.workItems.requirementRefs.set(REQUIREMENT_ID, {
      requirementOwnerId: RELATED_USER_ID,
    });
    subject.workItems.intakeRefs.set(INTAKE_ITEM_ID, {
      intakeReporterId: VIEWER_ID,
    });
    subject.spaces.addMember(ASSIGNEE_ID, "DEVELOPER");
    subject.organizations.addMember(ASSIGNEE_ID);

    const updated = await subject.service.update(
      ACTOR_ID,
      WORK_ITEM_ID,
      {
        assigneeId: ASSIGNEE_ID,
        dueDate: "2026-06-10T00:00:00.000Z",
        priority: "URGENT",
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
      },
      { requestId: "req-workitem-update" },
    );

    expect(updated).toMatchObject({
      assigneeId: ASSIGNEE_ID,
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "NOT_STARTED",
      workflowVersionId: WORKFLOW_VERSION_ID,
    });
    expect(subject.workItems.updatedInput).toMatchObject({
      assigneeId: ASSIGNEE_ID,
      priority: "URGENT",
      shouldReplaceAssigneeParticipants: true,
      shouldReplaceRelatedParticipants: true,
    });
    expect(subject.workItems.updatedInput?.relatedUserIds.sort()).toEqual([
      VIEWER_ID,
      RELATED_USER_ID,
    ]);
    expect(subject.workItems.updatedInput).not.toHaveProperty(
      "workflowVersionId",
    );
    expect(subject.workItems.updatedInput).not.toHaveProperty("currentStateId");
    expect(subject.workItems.updatedInput).not.toHaveProperty("statusCategory");
    expect(subject.workItems.updatedInput?.timelineAfter).toMatchObject({
      assigneeId: ASSIGNEE_ID,
      dueDate: "2026-06-10T00:00:00.000Z",
      priority: "URGENT",
    });
    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_ID,
        after: expect.objectContaining({ id: updated.id }),
        before: expect.objectContaining({ id: WORK_ITEM_ID }),
        metadata: { operation: "UPDATE_FIELDS" },
        organizationId: ORGANIZATION_ID,
        requestId: "req-workitem-update",
        spaceId: SPACE_ID,
        targetId: WORK_ITEM_ID,
        targetType: "WORK_ITEM",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "UPDATED",
        target: { type: "WORK_ITEM", id: WORK_ITEM_ID },
        invalidates: expect.arrayContaining([
          "work-item-list",
          "version-board",
          "timeline",
        ]),
        hints: expect.objectContaining({
          changedFields: expect.arrayContaining([
            "assigneeId",
            "dueDate",
            "priority",
          ]),
          workItemType: "TASK",
        }),
      }),
    );
  });

  it("allows independent TASK version edits without requirement or intake links", async () => {
    const subject = createSubject("PM");
    subject.workItems.items.set(WORK_ITEM_ID, makeWorkItem());
    subject.workItems.versionRefs.set(VERSION_TWO_ID, {});

    const updated = await subject.service.update(ACTOR_ID, WORK_ITEM_ID, {
      versionId: VERSION_TWO_ID,
    });

    expect(updated.versionId).toBe(VERSION_TWO_ID);
    expect(subject.workItems.updatedInput?.versionId).toBe(VERSION_TWO_ID);
  });

  it("blocks TASK version edits that affect related bugs until cascade is confirmed", async () => {
    const subject = createSubject("PM");
    subject.workItems.items.set(
      WORK_ITEM_ID,
      makeWorkItem({ versionId: VERSION_ID }),
    );
    subject.workItems.items.set(
      BUG_ID,
      makeWorkItem({
        id: BUG_ID,
        title: "Related bug",
        type: "BUG",
        versionId: VERSION_ID,
      }),
    );
    subject.workItems.relatedBugTaskIds.set(BUG_ID, WORK_ITEM_ID);
    subject.workItems.versionRefs.set(VERSION_TWO_ID, {});

    await expect(
      subject.service.update(ACTOR_ID, WORK_ITEM_ID, {
        versionId: VERSION_TWO_ID,
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
      details: expect.objectContaining({
        impact: expect.objectContaining({
          relatedBugCount: 1,
          relatedBugIds: [BUG_ID],
        }),
        targetType: "TASK",
      }),
    });
    expect(subject.workItems.updatedInput).toBeUndefined();
    expect(subject.workItems.items.get(BUG_ID)?.versionId).toBe(VERSION_ID);
  });

  it("cascades TASK version edits to related bugs after confirmation", async () => {
    const subject = createSubject("PM");
    subject.workItems.items.set(
      WORK_ITEM_ID,
      makeWorkItem({ versionId: VERSION_ID }),
    );
    subject.workItems.items.set(
      BUG_ID,
      makeWorkItem({
        id: BUG_ID,
        title: "Related bug",
        type: "BUG",
        versionId: VERSION_ID,
      }),
    );
    subject.workItems.relatedBugTaskIds.set(BUG_ID, WORK_ITEM_ID);
    subject.workItems.versionRefs.set(VERSION_TWO_ID, {});

    const updated = await subject.service.update(ACTOR_ID, WORK_ITEM_ID, {
      cascadeVersionChange: true,
      versionId: VERSION_TWO_ID,
    });

    expect(updated.versionId).toBe(VERSION_TWO_ID);
    expect(subject.workItems.items.get(BUG_ID)?.versionId).toBe(
      VERSION_TWO_ID,
    );
    expect(subject.workItems.updatedInput).toMatchObject({
      cascadeVersionChange: true,
      versionId: VERSION_TWO_ID,
    });
    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          operation: "UPDATE_FIELDS",
          versionCascade: expect.objectContaining({
            relatedBugCount: 1,
            relatedBugIds: [BUG_ID],
          }),
        }),
      }),
    );
  });

  it("inherits requirement version when relinking a TASK requirement", async () => {
    const subject = createSubject("PM");
    subject.workItems.items.set(WORK_ITEM_ID, makeWorkItem());
    subject.workItems.versionRefs.set(VERSION_ID, {});
    subject.workItems.requirementRefs.set(REQUIREMENT_ID, {
      requirementVersionId: VERSION_ID,
    });

    const updated = await subject.service.update(ACTOR_ID, WORK_ITEM_ID, {
      requirementId: REQUIREMENT_ID,
    });

    expect(updated.requirementId).toBe(REQUIREMENT_ID);
    expect(updated.versionId).toBe(VERSION_ID);
    expect(subject.workItems.updatedInput).toMatchObject({
      requirementId: REQUIREMENT_ID,
      versionId: VERSION_ID,
    });
  });

  it("inherits intake version when relinking a TASK intake item", async () => {
    const subject = createSubject("PM");
    subject.workItems.items.set(WORK_ITEM_ID, makeWorkItem());
    subject.workItems.versionRefs.set(VERSION_ID, {});
    subject.workItems.intakeRefs.set(INTAKE_ITEM_ID, {
      intakeVersionId: VERSION_ID,
    });

    const updated = await subject.service.update(ACTOR_ID, WORK_ITEM_ID, {
      intakeItemId: INTAKE_ITEM_ID,
    });

    expect(updated.intakeItemId).toBe(INTAKE_ITEM_ID);
    expect(updated.versionId).toBe(VERSION_ID);
    expect(subject.workItems.updatedInput).toMatchObject({
      intakeItemId: INTAKE_ITEM_ID,
      versionId: VERSION_ID,
    });
  });

  it("does not allow unchecked update input to change blocked state fields", async () => {
    const subject = createSubject("PM");
    subject.workItems.items.set(
      WORK_ITEM_ID,
      makeWorkItem({
        blockedAt: "2026-05-14T00:00:00.000Z",
        blockedReason: "Existing blocker",
      }),
    );
    subject.workItems.participantKeys.add(`${WORK_ITEM_ID}:${ACTOR_ID}`);

    const updated = await subject.service.update(ACTOR_ID, WORK_ITEM_ID, {
      blockedReason: "New blocker",
    } as unknown as Parameters<WorkItemService["update"]>[2]);

    expect(updated.blockedReason).toBe("Existing blocker");
    expect(updated.blockedAt).toBe("2026-05-14T00:00:00.000Z");
    expect(subject.workItems.updatedInput).not.toHaveProperty("blockedReason");
    expect(subject.workItems.updatedInput).not.toHaveProperty("blockedAt");
    expect(subject.workItems.updatedInput?.timelineAfter).not.toHaveProperty(
      "blockedReason",
    );
  });

  it.each(["DEVELOPER", "TESTER", "MEMBER"] as const)(
    "rejects %s direct TASK patches even when the task is visible",
    async (role) => {
      const subject = createSubject(role);
      subject.workItems.items.set(
        WORK_ITEM_ID,
        makeWorkItem({
          assigneeId: ACTOR_ID,
        }),
      );
      subject.workItems.participantKeys.add(`${WORK_ITEM_ID}:${ACTOR_ID}`);
      subject.workItems.testerVisibleIds.add(WORK_ITEM_ID);

      await expect(
        subject.service.update(
          ACTOR_ID,
          WORK_ITEM_ID,
          {
            priority: "HIGH",
            title: `${role} direct edit`,
          },
          { requestId: `req-task-denied-${role}` },
        ),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });
      expect(subject.workItems.updatedInput).toBeUndefined();
      expect(subject.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "ACCESS_DENIED",
          actorId: ACTOR_ID,
          metadata: expect.objectContaining({
            operation: "updateWorkItem",
            reason: "ROLE_NOT_ALLOWED",
            role,
          }),
          organizationId: ORGANIZATION_ID,
          requestId: `req-task-denied-${role}`,
          spaceId: SPACE_ID,
          targetId: WORK_ITEM_ID,
          targetType: "WORK_ITEM",
        }),
      );
    },
  );
});

function createSubject(role: SpaceRole, actorUserId = ACTOR_ID) {
  const workItems = new FakeWorkItemRepository();
  const spaces = new FakeSpaceRepository();
  const organizations = new FakeOrganizationRepository();
  const audit = createAuditService();
  const realtime = createRealtimePublisher();

  spaces.addAccess(actorUserId, role);
  spaces.addMember(actorUserId, role);
  organizations.addMember(actorUserId);

  return {
    audit,
    organizations,
    realtime,
    service: new WorkItemService(
      workItems,
      spaces as unknown as SpaceRepository,
      organizations as unknown as OrganizationRepository,
      createPermissionResolver(
        role,
      ) as unknown as WorkflowActionExecutionService,
      audit,
      realtime,
    ),
    spaces,
    workItems,
  };
}

function createAuditService() {
  return {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
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
  const canWrite = role !== "VIEWER";

  return {
    async resolvePermissionSnapshot() {
      return {
        availableActions: [],
        canComment: canWrite,
        canEdit: canWrite,
        canUploadAttachment: canWrite,
      };
    },
  };
}

class FakeWorkItemRepository implements WorkItemRepository {
  createdInput?: CreateWorkItemInput;
  updatedInput?: UpdateWorkItemInput;
  listInput?: WorkItemListInput;
  workflowSelectionInput?: {
    spaceId: string;
    workflowVersionId?: string;
  };
  workflowSelection?: WorkItemWorkflowSelection;
  readonly items = new Map<string, WorkItem>();
  readonly participantKeys = new Set<string>();
  readonly testerVisibleIds = new Set<string>();
  readonly versionRefs = new Map<string, WorkItemLinkedUsers>();
  readonly requirementRefs = new Map<string, WorkItemLinkedUsers>();
  readonly intakeRefs = new Map<string, WorkItemLinkedUsers>();
  readonly relatedBugTaskIds = new Map<string, string>();

  async create(input: CreateWorkItemInput) {
    this.createdInput = input;
    const item = makeWorkItem({
      assigneeId: input.assigneeId,
      currentStateId: input.currentStateId,
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
    });

    this.items.set(item.id, item);
    return item;
  }

  async findTaskById(workItemId: string) {
    return this.items.get(workItemId);
  }

  async countVersionCascadeImpact(input: {
    workItemId: string;
    nextVersionId: string | null;
  }) {
    const relatedBugIds = [...this.relatedBugTaskIds.entries()]
      .filter(([, taskId]) => taskId === input.workItemId)
      .map(([bugId]) => this.items.get(bugId))
      .filter(
        (bug): bug is WorkItem =>
          Boolean(bug) &&
          bug?.type === "BUG" &&
          (bug.versionId ?? null) !== input.nextVersionId,
      )
      .map((bug) => bug.id);

    return {
      bugCount: 0,
      bugIds: [],
      relatedBugCount: relatedBugIds.length,
      relatedBugIds,
      workItemCount: relatedBugIds.length,
      workItemIds: relatedBugIds,
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

  async isParticipant(_spaceId: string, workItemId: string, userId: string) {
    return this.participantKeys.has(`${workItemId}:${userId}`);
  }

  async isTesterVisible(_spaceId: string, workItemId: string) {
    return this.testerVisibleIds.has(workItemId);
  }

  async listBySpaceId(_spaceId: string, input: WorkItemListInput) {
    this.listInput = input;
    return {
      items: [],
      page: input.page,
      pageSize: input.pageSize,
      total: 0,
    };
  }

  async resolveTaskWorkflow(spaceId: string, workflowVersionId?: string) {
    this.workflowSelectionInput = { spaceId, workflowVersionId };
    return this.workflowSelection;
  }

  async update(input: UpdateWorkItemInput) {
    this.updatedInput = input;
    const existing = this.items.get(input.workItemId);

    if (!existing) {
      return undefined;
    }

    const updated = makeWorkItem({
      ...existing,
      assigneeId: applyOptional(input.assigneeId, existing.assigneeId),
      description: applyOptional(input.description, existing.description),
      dueDate: applyOptionalDate(input.dueDate, existing.dueDate),
      intakeItemId: applyOptional(input.intakeItemId, existing.intakeItemId),
      priority: input.priority ?? existing.priority,
      requirementId: applyOptional(input.requirementId, existing.requirementId),
      title: input.title ?? existing.title,
      versionId: applyOptional(input.versionId, existing.versionId),
    });

    this.items.set(updated.id, updated);

    if (
      input.cascadeVersionChange === true &&
      input.versionId !== undefined &&
      (existing.versionId ?? null) !== input.versionId
    ) {
      for (const [bugId, taskId] of this.relatedBugTaskIds.entries()) {
        if (taskId !== input.workItemId) {
          continue;
        }

        const bug = this.items.get(bugId);

        if (!bug || bug.type !== "BUG") {
          continue;
        }

        this.items.set(
          bugId,
          makeWorkItem({
            ...bug,
            versionId: applyOptional(input.versionId, bug.versionId),
          }),
        );
      }
    }

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

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    currentStateId: CURRENT_STATE_ID,
    id: WORK_ITEM_ID,
    lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    priority: "MEDIUM",
    reporterId: ACTOR_ID,
    spaceId: SPACE_ID,
    statusCategory: "NOT_STARTED",
    title: "Existing task",
    type: "TASK",
    workflowVersionId: WORKFLOW_VERSION_ID,
    ...overrides,
    tags: overrides.tags ?? [],
  };
}
