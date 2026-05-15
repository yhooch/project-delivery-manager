import { describe, expect, it } from "vitest";

import type {
  OrganizationMemberWithUser,
  Space,
  SpaceMemberWithUser,
  SpaceRole,
  WorkItem,
} from "@project-delivery/shared";
import type { OrganizationRepository } from "../organization/organization.repository";
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

describe("WorkItemService", () => {
  it("creates TASK work items with the default workflow start state and participants", async () => {
    const subject = createSubject("DEVELOPER");

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

    const created = await subject.service.create(ACTOR_ID, SPACE_ID, {
      assigneeId: ASSIGNEE_ID,
      dueDate: "2026-06-01T00:00:00.000Z",
      intakeItemId: INTAKE_ITEM_ID,
      priority: "HIGH",
      requirementId: REQUIREMENT_ID,
      title: "Implement task API",
      type: "TASK",
      versionId: VERSION_ID,
    });

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

    await expect(subject.service.get(ACTOR_ID, WORK_ITEM_ID)).rejects.toMatchObject({
      code: "WORK_ITEM_NOT_FOUND",
    });

    subject.workItems.testerVisibleIds.add(WORK_ITEM_ID);

    await expect(subject.service.get(ACTOR_ID, WORK_ITEM_ID)).resolves.toMatchObject({
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

    const updated = await subject.service.update(ACTOR_ID, WORK_ITEM_ID, {
      assigneeId: ASSIGNEE_ID,
      dueDate: "2026-06-10T00:00:00.000Z",
      priority: "URGENT",
      requirementId: REQUIREMENT_ID,
      versionId: VERSION_ID,
    });

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
        subject.service.update(ACTOR_ID, WORK_ITEM_ID, {
          priority: "HIGH",
          title: `${role} direct edit`,
        }),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });
      expect(subject.workItems.updatedInput).toBeUndefined();
    },
  );
});

function createSubject(role: SpaceRole, actorUserId = ACTOR_ID) {
  const workItems = new FakeWorkItemRepository();
  const spaces = new FakeSpaceRepository();
  const organizations = new FakeOrganizationRepository();

  spaces.addAccess(actorUserId, role);
  spaces.addMember(actorUserId, role);
  organizations.addMember(actorUserId);

  return {
    organizations,
    service: new WorkItemService(
      workItems,
      spaces as unknown as SpaceRepository,
      organizations as unknown as OrganizationRepository,
      createPermissionResolver(role) as unknown as WorkflowActionExecutionService,
    ),
    spaces,
    workItems,
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
  workflowSelection?: WorkItemWorkflowSelection;
  readonly items = new Map<string, WorkItem>();
  readonly participantKeys = new Set<string>();
  readonly testerVisibleIds = new Set<string>();
  readonly versionRefs = new Map<string, WorkItemLinkedUsers>();
  readonly requirementRefs = new Map<string, WorkItemLinkedUsers>();
  readonly intakeRefs = new Map<string, WorkItemLinkedUsers>();

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

  async resolveTaskWorkflow(_spaceId: string, _workflowVersionId?: string) {
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

function applyOptional<T>(value: T | null | undefined, fallback: T | undefined) {
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
  };
}
