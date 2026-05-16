import { describe, expect, it, vi } from "vitest";

import type { SpaceRole } from "@project-delivery/shared";
import type { AuditService } from "../audit/audit.service";
import type { OrganizationRepository } from "../organization/organization.repository";
import type { RequirementRepository } from "../requirement/requirement.repository";
import type { SpaceRepository } from "../space/space.repository";
import type { VersionRepository } from "../version/version.repository";
import type { WorkItemRepository } from "../workitem/workitem.repository";
import type { IntakeRepository } from "./intake.repository";
import { IntakeService } from "./intake.service";
import type { ConvertIntakeItemToWorkItemsInput } from "./intake.types";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_USER_ID = "01H00000000000000000000002";
const ASSIGNEE_ID = "01H00000000000000000000003";
const VERSION_ID = "01H00000000000000000000004";
const REQUIREMENT_ID = "01H00000000000000000000005";
const INTAKE_ITEM_ID = "01H00000000000000000000006";
const WORKFLOW_VERSION_ID = "01H00000000000000000000007";
const CURRENT_STATE_ID = "01H00000000000000000000008";
const WORK_ITEM_ID = "01H00000000000000000000009";
const VERSION_TWO_ID = "01H00000000000000000000010";

describe("IntakeService", () => {
  it("lists full space intake for PM and participant-only intake for other roles", async () => {
    const pm = createSubject({ role: "PM" });

    await pm.service.list(ACTOR_USER_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(pm.intakeItems.listBySpaceId).toHaveBeenCalledWith(
      SPACE_ID,
      expect.not.objectContaining({
        restrictToParticipantUserId: ACTOR_USER_ID,
      }),
    );

    const developer = createSubject({ role: "DEVELOPER" });

    await developer.service.list(ACTOR_USER_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(developer.intakeItems.listBySpaceId).toHaveBeenCalledWith(
      SPACE_ID,
      expect.objectContaining({
        restrictToParticipantUserId: ACTOR_USER_ID,
      }),
    );
  });

  it("denies writes for VIEWER", async () => {
    const { audit, service } = createSubject({ role: "VIEWER" });

    await expect(
      service.create(
        ACTOR_USER_ID,
        SPACE_ID,
        {
          title: "New request",
          sourceType: "AD_HOC",
        },
        { requestId: "req-intake-denied" },
      ),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "ACCESS_DENIED",
        actorId: ACTOR_USER_ID,
        metadata: expect.objectContaining({
          operation: "createIntakeItem",
          reason: "ROLE_NOT_ALLOWED",
          role: "VIEWER",
        }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-intake-denied",
        spaceId: SPACE_ID,
        targetId: SPACE_ID,
        targetType: "SPACE",
      }),
    );
  });

  it("creates an intake item with actor as reporter after validating references", async () => {
    const { audit, intakeItems, service } = createSubject({ role: "PM" });

    await service.create(
      ACTOR_USER_ID,
      SPACE_ID,
      {
        assigneeId: ASSIGNEE_ID,
        requirementId: REQUIREMENT_ID,
        sourceType: "REQUIREMENT_CHANGE",
        title: "Clarify scope",
        versionId: VERSION_ID,
      },
      { requestId: "req-intake-create" },
    );

    expect(intakeItems.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: ASSIGNEE_ID,
        organizationId: ORGANIZATION_ID,
        reporterId: ACTOR_USER_ID,
        requirementId: REQUIREMENT_ID,
        spaceId: SPACE_ID,
        versionId: VERSION_ID,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: ACTOR_USER_ID,
        after: expect.objectContaining({
          id: INTAKE_ITEM_ID,
          title: "Clarify scope",
        }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-intake-create",
        spaceId: SPACE_ID,
        targetId: INTAKE_ITEM_ID,
        targetType: "INTAKE_ITEM",
      }),
    );
  });

  it("inherits requirement version when creating intake without an explicit version", async () => {
    const { intakeItems, service } = createSubject({ role: "PM" });

    await service.create(ACTOR_USER_ID, SPACE_ID, {
      requirementId: REQUIREMENT_ID,
      sourceType: "REQUIREMENT_CHANGE",
      title: "Follow requirement version",
    });

    expect(intakeItems.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
      }),
    );
  });

  it("rejects intake create when requirement belongs to another version", async () => {
    const { intakeItems, requirements, service } = createSubject({
      role: "PM",
    });
    vi.mocked(requirements.findById).mockResolvedValueOnce(
      requirement({ versionId: VERSION_TWO_ID }),
    );

    await expect(
      service.create(ACTOR_USER_ID, SPACE_ID, {
        requirementId: REQUIREMENT_ID,
        sourceType: "REQUIREMENT_CHANGE",
        title: "Cross-version intake",
        versionId: VERSION_ID,
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CONFLICT",
    });
    expect(intakeItems.create).not.toHaveBeenCalled();
  });

  it("hides a single intake item from non-privileged non-participants", async () => {
    const { service } = createSubject({
      hasParticipant: false,
      role: "DEVELOPER",
    });

    await expect(
      service.get(ACTOR_USER_ID, INTAKE_ITEM_ID),
    ).rejects.toMatchObject({
      code: "INTAKE_ITEM_NOT_FOUND",
    });
  });

  it("allows PM to update intake fields after validating references", async () => {
    const { intakeItems, service } = createSubject({ role: "PM" });

    await service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      assigneeId: ASSIGNEE_ID,
      title: "Updated intake",
    });

    expect(intakeItems.update).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: ASSIGNEE_ID,
        intakeItemId: INTAKE_ITEM_ID,
        shouldUpdateAssignee: true,
        title: "Updated intake",
        updatedById: ACTOR_USER_ID,
      }),
    );
  });

  it("passes null update fields through to clear optional intake values", async () => {
    const { intakeItems, service } = createSubject({
      item: intakeItem({
        assigneeId: ASSIGNEE_ID,
        description: "Old description",
        priority: "MEDIUM",
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
      }),
      role: "PM",
    });

    const updated = await service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      assigneeId: null,
      description: null,
      priority: null,
      requirementId: null,
      versionId: null,
    });

    expect(updated.assigneeId).toBeUndefined();
    expect(updated.description).toBeUndefined();
    expect(updated.priority).toBeUndefined();
    expect(updated.requirementId).toBeUndefined();
    expect(updated.versionId).toBeUndefined();
    expect(intakeItems.update).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: null,
        description: null,
        intakeItemId: INTAKE_ITEM_ID,
        priority: null,
        requirementId: null,
        shouldUpdateAssignee: true,
        versionId: null,
      }),
    );
  });

  it("rejects intake update when final requirement and version differ", async () => {
    const { intakeItems, requirements, service } = createSubject({
      item: intakeItem({
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
      }),
      role: "PM",
    });
    vi.mocked(requirements.findById).mockResolvedValueOnce(
      requirement({ versionId: VERSION_ID }),
    );

    await expect(
      service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
        versionId: VERSION_TWO_ID,
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CONFLICT",
    });
    expect(intakeItems.update).not.toHaveBeenCalled();
  });

  it("inherits the new requirement version when updating intake requirement", async () => {
    const { intakeItems, service } = createSubject({
      item: intakeItem({
        versionId: VERSION_TWO_ID,
      }),
      role: "PM",
    });

    await service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      requirementId: REQUIREMENT_ID,
    });

    expect(intakeItems.update).toHaveBeenCalledWith(
      expect.objectContaining({
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
      }),
    );
  });

  it("requires cascade confirmation when changing an intake requirement moves converted work items", async () => {
    const { intakeItems, service } = createSubject({
      item: intakeItem({
        status: "CONVERTED",
        versionId: VERSION_TWO_ID,
      }),
      role: "PM",
    });
    vi.mocked(intakeItems.countVersionCascadeImpact).mockResolvedValue({
      bugCount: 0,
      relatedBugCount: 1,
      workItemCount: 2,
    });

    await expect(
      service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
        requirementId: REQUIREMENT_ID,
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
    });
    expect(intakeItems.update).not.toHaveBeenCalled();

    await service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      cascadeVersionChange: true,
      requirementId: REQUIREMENT_ID,
    });

    expect(intakeItems.update).toHaveBeenCalledWith(
      expect.objectContaining({
        cascadeVersionChange: true,
        requirementId: REQUIREMENT_ID,
        versionId: VERSION_ID,
      }),
    );
  });

  it("requires cascade confirmation when an intake version change affects converted work items", async () => {
    const { intakeItems, service } = createSubject({
      item: intakeItem({
        status: "CONVERTED",
        versionId: VERSION_ID,
      }),
      role: "PM",
    });
    vi.mocked(intakeItems.countVersionCascadeImpact).mockResolvedValue({
      bugCount: 1,
      relatedBugCount: 1,
      workItemCount: 2,
    });

    await expect(
      service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
        versionId: VERSION_TWO_ID,
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
    });
    expect(intakeItems.update).not.toHaveBeenCalled();

    await service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      cascadeVersionChange: true,
      versionId: VERSION_TWO_ID,
    });

    expect(intakeItems.update).toHaveBeenCalledWith(
      expect.objectContaining({
        cascadeVersionChange: true,
        versionId: VERSION_TWO_ID,
      }),
    );
  });

  it("accepts pending intake items and rejects illegal status changes", async () => {
    const { audit, intakeItems, service } = createSubject({
      item: intakeItem({ status: "PENDING" }),
      role: "PM",
    });

    await service.accept(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      requestId: "req-intake-accept",
    });

    expect(intakeItems.updateStatus).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      intakeItemId: INTAKE_ITEM_ID,
      status: "ACCEPTED",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_USER_ID,
        before: expect.objectContaining({ status: "PENDING" }),
        metadata: { operation: "TRANSITION_STATUS", status: "ACCEPTED" },
        organizationId: ORGANIZATION_ID,
        requestId: "req-intake-accept",
        spaceId: SPACE_ID,
        targetId: INTAKE_ITEM_ID,
        targetType: "INTAKE_ITEM",
      }),
    );

    const converted = createSubject({
      item: intakeItem({ status: "CONVERTED" }),
      role: "PM",
    });

    await expect(
      converted.service.reject(ACTOR_USER_ID, INTAKE_ITEM_ID),
    ).rejects.toMatchObject({
      code: "INTAKE_ITEM_ALREADY_CONVERTED",
    });

    const accepted = createSubject({
      item: intakeItem({ status: "ACCEPTED" }),
      role: "PM",
    });

    await expect(
      accepted.service.defer(ACTOR_USER_ID, INTAKE_ITEM_ID),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it.each(["DEVELOPER", "TESTER", "MEMBER"] as const)(
    "rejects %s intake decisions even when the item is visible",
    async (role) => {
      const pending = createSubject({
        item: intakeItem({ status: "PENDING" }),
        role,
      });

      await expect(
        pending.service.update(ACTOR_USER_ID, INTAKE_ITEM_ID, {
          title: `${role} direct edit`,
        }),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });
      await expect(
        pending.service.accept(ACTOR_USER_ID, INTAKE_ITEM_ID),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });
      await expect(
        pending.service.defer(ACTOR_USER_ID, INTAKE_ITEM_ID),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });
      await expect(
        pending.service.reject(ACTOR_USER_ID, INTAKE_ITEM_ID),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });
      expect(pending.intakeItems.update).not.toHaveBeenCalled();
      expect(pending.intakeItems.updateStatus).not.toHaveBeenCalled();

      const accepted = createSubject({
        item: intakeItem({ status: "ACCEPTED" }),
        role,
      });

      await expect(
        accepted.service.convertToWorkItems(ACTOR_USER_ID, INTAKE_ITEM_ID, {
          tasks: [{ title: `${role} converted task` }],
        }),
      ).rejects.toMatchObject({
        code: "SPACE_ACCESS_DENIED",
      });
      expect(accepted.intakeItems.convertToWorkItems).not.toHaveBeenCalled();
    },
  );

  it("converts an accepted intake item to one TASK with inherited context", async () => {
    const { audit, intakeItems, service } = createSubject({
      item: intakeItem({
        assigneeId: ASSIGNEE_ID,
        requirementId: REQUIREMENT_ID,
        status: "ACCEPTED",
        versionId: VERSION_ID,
      }),
      role: "PM",
    });

    const result = await service.convertToWorkItems(
      ACTOR_USER_ID,
      INTAKE_ITEM_ID,
      {
        tasks: [
          {
            dueDate: "2026-06-01T00:00:00.000Z",
            title: "Implement converted task",
          },
        ],
      },
      { requestId: "req-intake-convert" },
    );

    expect(result).toMatchObject({
      intakeItemId: INTAKE_ITEM_ID,
      workItems: [
        {
          intakeItemId: INTAKE_ITEM_ID,
          requirementId: REQUIREMENT_ID,
          title: "Implement converted task",
          versionId: VERSION_ID,
        },
      ],
    });
    expect(intakeItems.convertToWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_USER_ID,
        intakeItemId: INTAKE_ITEM_ID,
        tasks: [
          expect.objectContaining({
            assigneeId: ASSIGNEE_ID,
            dueDate: expect.any(Date),
            priority: "MEDIUM",
            reporterId: ACTOR_USER_ID,
            requirementId: REQUIREMENT_ID,
            versionId: VERSION_ID,
          }),
        ],
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_USER_ID,
        after: {
          status: "CONVERTED",
          workItemIds: [WORK_ITEM_ID],
        },
        before: expect.objectContaining({ id: INTAKE_ITEM_ID }),
        metadata: {
          operation: "CONVERT_TO_WORK_ITEMS",
          taskCount: 1,
          workItemIds: [WORK_ITEM_ID],
        },
        organizationId: ORGANIZATION_ID,
        requestId: "req-intake-convert",
        spaceId: SPACE_ID,
        targetId: INTAKE_ITEM_ID,
        targetType: "INTAKE_ITEM",
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: ACTOR_USER_ID,
        after: expect.objectContaining({
          id: WORK_ITEM_ID,
          intakeItemId: INTAKE_ITEM_ID,
        }),
        metadata: {
          intakeItemId: INTAKE_ITEM_ID,
          operation: "CREATED_BY_INTAKE_CONVERSION",
        },
        organizationId: ORGANIZATION_ID,
        requestId: "req-intake-convert",
        spaceId: SPACE_ID,
        targetId: WORK_ITEM_ID,
        targetType: "WORK_ITEM",
      }),
    );
  });

  it("converts an accepted intake item to multiple TASKs in one repository call", async () => {
    const { intakeItems, service } = createSubject({
      item: intakeItem({
        priority: "HIGH",
        status: "ACCEPTED",
      }),
      role: "PM",
    });

    await service.convertToWorkItems(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      tasks: [
        {
          priority: "LOW",
          title: "First task",
        },
        {
          title: "Second task",
        },
      ],
    });

    expect(intakeItems.convertToWorkItems).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(intakeItems.convertToWorkItems).mock.calls[0]?.[0].tasks,
    ).toEqual([
      expect.objectContaining({
        priority: "LOW",
        title: "First task",
      }),
      expect.objectContaining({
        priority: "HIGH",
        title: "Second task",
      }),
    ]);
  });

  it("honors explicit convert task fields from the request schema", async () => {
    const { intakeItems, service, workItems } = createSubject({
      item: intakeItem({
        description: "Inherited description",
        status: "ACCEPTED",
      }),
      role: "PM",
    });

    await service.convertToWorkItems(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      tasks: [
        {
          assigneeId: ASSIGNEE_ID,
          description: "Task-specific description",
          dueDate: "2026-06-01T00:00:00.000Z",
          priority: "URGENT",
          requirementId: REQUIREMENT_ID,
          title: "Explicit converted task",
          versionId: VERSION_ID,
          workflowVersionId: WORKFLOW_VERSION_ID,
        },
      ],
    });

    expect(workItems.resolveTaskWorkflow).toHaveBeenCalledWith(
      SPACE_ID,
      WORKFLOW_VERSION_ID,
    );
    expect(intakeItems.convertToWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({
            assigneeId: ASSIGNEE_ID,
            description: "Task-specific description",
            dueDate: expect.any(Date),
            priority: "URGENT",
            requirementId: REQUIREMENT_ID,
            title: "Explicit converted task",
            versionId: VERSION_ID,
            workflowVersionId: WORKFLOW_VERSION_ID,
          }),
        ],
      }),
    );
  });

  it("rejects converted task rows when requirement belongs to another version", async () => {
    const { intakeItems, requirements, service } = createSubject({
      item: intakeItem({
        status: "ACCEPTED",
        versionId: VERSION_ID,
      }),
      role: "PM",
    });
    vi.mocked(requirements.findById).mockResolvedValueOnce(
      requirement({ versionId: VERSION_TWO_ID }),
    );

    await expect(
      service.convertToWorkItems(ACTOR_USER_ID, INTAKE_ITEM_ID, {
        tasks: [
          {
            requirementId: REQUIREMENT_ID,
            title: "Cross-version converted task",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CONFLICT",
    });
    expect(intakeItems.convertToWorkItems).not.toHaveBeenCalled();
  });

  it("rejects duplicate and non-accepted conversions with dedicated error codes", async () => {
    const converted = createSubject({
      item: intakeItem({ status: "CONVERTED" }),
      role: "PM",
    });

    await expect(
      converted.service.convertToWorkItems(ACTOR_USER_ID, INTAKE_ITEM_ID, {
        tasks: [{ title: "Already converted" }],
      }),
    ).rejects.toMatchObject({
      code: "INTAKE_ITEM_ALREADY_CONVERTED",
    });

    for (const status of ["PENDING", "DEFERRED", "REJECTED"] as const) {
      const subject = createSubject({
        item: intakeItem({ status }),
        role: "PM",
      });

      await expect(
        subject.service.convertToWorkItems(ACTOR_USER_ID, INTAKE_ITEM_ID, {
          tasks: [{ title: `Invalid ${status}` }],
        }),
      ).rejects.toMatchObject({
        code: "INTAKE_ITEM_NOT_ACCEPTED",
      });
    }
  });

  it("rejects invalid task input before writing converted work items", async () => {
    const { intakeItems, service } = createSubject({
      item: intakeItem({ status: "ACCEPTED" }),
      role: "PM",
    });

    await expect(
      service.convertToWorkItems(ACTOR_USER_ID, INTAKE_ITEM_ID, {
        tasks: [
          {
            title: "Valid task",
          },
          {
            dueDate: "not-a-date",
            title: "Invalid task",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(intakeItems.convertToWorkItems).not.toHaveBeenCalled();
  });

  it("rejects cross-space version and requirement references", async () => {
    const { requirements, service, versions } = createSubject({ role: "PM" });
    vi.mocked(versions.findById).mockResolvedValueOnce(
      version({ spaceId: "01H00000000000000000000099" }),
    );

    await expect(
      service.create(ACTOR_USER_ID, SPACE_ID, {
        sourceType: "AD_HOC",
        title: "Wrong version",
        versionId: VERSION_ID,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    vi.mocked(requirements.findById).mockResolvedValueOnce(
      requirement({ spaceId: "01H00000000000000000000099" }),
    );

    await expect(
      service.create(ACTOR_USER_ID, SPACE_ID, {
        requirementId: REQUIREMENT_ID,
        sourceType: "AD_HOC",
        title: "Wrong requirement",
      }),
    ).rejects.toMatchObject({
      code: "REQUIREMENT_NOT_FOUND",
    });
  });
});

function createSubject(input: {
  hasParticipant?: boolean;
  item?: ReturnType<typeof intakeItem>;
  role: SpaceRole;
}) {
  const item = input.item ?? intakeItem();
  const intakeItems = {
    convertToWorkItems: vi.fn(
      async (convertInput: ConvertIntakeItemToWorkItemsInput) => ({
        intakeItemId: convertInput.intakeItemId,
        workItems: convertInput.tasks.map((task, index) =>
          workItem({
            assigneeId: task.assigneeId,
            currentStateId: task.currentStateId,
            dueDate: task.dueDate?.toISOString(),
            id:
              index === 0
                ? WORK_ITEM_ID
                : `${WORK_ITEM_ID.slice(0, 25)}${index}`,
            intakeItemId: convertInput.intakeItemId,
            priority: task.priority,
            reporterId: task.reporterId,
            requirementId: task.requirementId,
            statusCategory: task.statusCategory,
            title: task.title,
            versionId: task.versionId,
            workflowVersionId: task.workflowVersionId,
          }),
        ),
      }),
    ),
    create: vi.fn(async (createInput) =>
      intakeItem({
        assigneeId: createInput.assigneeId,
        reporterId: createInput.reporterId,
        requirementId: createInput.requirementId,
        sourceType: createInput.sourceType,
        spaceId: createInput.spaceId,
        title: createInput.title,
        versionId: createInput.versionId,
      }),
    ),
    findById: vi.fn(async () => item),
    countVersionCascadeImpact: vi.fn(async () => ({
      bugCount: 0,
      relatedBugCount: 0,
      workItemCount: 0,
    })),
    hasParticipant: vi.fn(async () => input.hasParticipant ?? true),
    listBySpaceId: vi.fn(async (_spaceId, listInput) => ({
      items: [],
      page: listInput.page,
      pageSize: listInput.pageSize,
      total: 0,
    })),
    update: vi.fn(async (updateInput) =>
      intakeItem({
        ...item,
        assigneeId: applyOptional(updateInput.assigneeId, item.assigneeId),
        description: applyOptional(updateInput.description, item.description),
        priority: applyOptional(updateInput.priority, item.priority),
        requirementId: applyOptional(
          updateInput.requirementId,
          item.requirementId,
        ),
        title: updateInput.title ?? item.title,
        versionId: applyOptional(updateInput.versionId, item.versionId),
      }),
    ),
    updateStatus: vi.fn(async (statusInput) =>
      intakeItem({
        ...item,
        status: statusInput.status,
      }),
    ),
  } satisfies IntakeRepository;

  const spaces = {
    findAccessibleById: vi.fn(async () => ({
      role: input.role,
      space: {
        code: "delivery",
        id: SPACE_ID,
        name: "Delivery",
        organizationId: ORGANIZATION_ID,
        settings: {
          staleThresholdDays: 3,
        },
        status: "ACTIVE" as const,
      },
    })),
    findMemberByUserId: vi.fn(async () => ({
      id: "01H00000000000000000000007",
      organizationId: ORGANIZATION_ID,
      role: "DEVELOPER" as const,
      spaceId: SPACE_ID,
      status: "ACTIVE" as const,
      user: {
        id: ASSIGNEE_ID,
        name: "Assignee",
        status: "ACTIVE" as const,
        username: "assignee",
      },
      userId: ASSIGNEE_ID,
    })),
  };

  const versions = {
    findById: vi.fn(async () => version()),
  };

  const requirements = {
    findById: vi.fn(async () => requirement()),
  };

  const organizations = {
    findMemberByUserId: vi.fn(async () => ({
      id: "01H00000000000000000000008",
      organizationId: ORGANIZATION_ID,
      role: "MEMBER" as const,
      status: "ACTIVE" as const,
      userId: ASSIGNEE_ID,
    })),
  };

  const workItems = {
    create: vi.fn(),
    findIntakeItemInSpace: vi.fn(),
    findRequirementInSpace: vi.fn(),
    findTaskById: vi.fn(),
    findVersionInSpace: vi.fn(),
    isParticipant: vi.fn(),
    isTesterVisible: vi.fn(async () => false),
    listBySpaceId: vi.fn(),
    resolveTaskWorkflow: vi.fn(async () => ({
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "NOT_STARTED" as const,
      workflowVersionId: WORKFLOW_VERSION_ID,
    })),
    update: vi.fn(),
  } satisfies WorkItemRepository;
  const audit = createAuditService();

  return {
    audit,
    intakeItems,
    organizations,
    requirements,
    service: new IntakeService(
      intakeItems,
      spaces as unknown as SpaceRepository,
      versions as unknown as VersionRepository,
      requirements as unknown as RequirementRepository,
      organizations as unknown as OrganizationRepository,
      workItems,
      audit,
    ),
    spaces,
    versions,
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

function applyOptional<T>(
  value: T | null | undefined,
  fallback: T | undefined,
) {
  if (value === undefined) {
    return fallback;
  }

  return value === null ? undefined : value;
}

function intakeItem(
  overrides: Partial<{
    assigneeId: string;
    description: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    reporterId: string;
    requirementId: string;
    sourceType: "REQUIREMENT_CHANGE" | "AD_HOC";
    spaceId: string;
    status: "PENDING" | "ACCEPTED" | "DEFERRED" | "REJECTED" | "CONVERTED";
    title: string;
    versionId: string;
  }> = {},
) {
  return {
    id: INTAKE_ITEM_ID,
    organizationId: ORGANIZATION_ID,
    reporterId: overrides.reporterId ?? ACTOR_USER_ID,
    sourceType: overrides.sourceType ?? "AD_HOC",
    spaceId: overrides.spaceId ?? SPACE_ID,
    status: overrides.status ?? "PENDING",
    title: overrides.title ?? "Intake item",
    ...(overrides.assigneeId ? { assigneeId: overrides.assigneeId } : {}),
    ...(overrides.description ? { description: overrides.description } : {}),
    ...(overrides.priority ? { priority: overrides.priority } : {}),
    ...(overrides.requirementId
      ? { requirementId: overrides.requirementId }
      : {}),
    ...(overrides.versionId ? { versionId: overrides.versionId } : {}),
  };
}

function workItem(
  overrides: Partial<{
    assigneeId: string;
    currentStateId: string;
    dueDate: string;
    id: string;
    intakeItemId: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    reporterId: string;
    requirementId: string;
    statusCategory:
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "WAITING"
      | "VERIFYING"
      | "DONE"
      | "TERMINATED";
    title: string;
    versionId: string;
    workflowVersionId: string;
  }> = {},
) {
  return {
    currentStateId: overrides.currentStateId ?? CURRENT_STATE_ID,
    id: overrides.id ?? WORK_ITEM_ID,
    lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    priority: overrides.priority ?? "MEDIUM",
    reporterId: overrides.reporterId ?? ACTOR_USER_ID,
    spaceId: SPACE_ID,
    statusCategory: overrides.statusCategory ?? "NOT_STARTED",
    title: overrides.title ?? "Work item",
    type: "TASK" as const,
    workflowVersionId: overrides.workflowVersionId ?? WORKFLOW_VERSION_ID,
    ...(overrides.assigneeId ? { assigneeId: overrides.assigneeId } : {}),
    ...(overrides.dueDate ? { dueDate: overrides.dueDate } : {}),
    ...(overrides.intakeItemId ? { intakeItemId: overrides.intakeItemId } : {}),
    ...(overrides.requirementId
      ? { requirementId: overrides.requirementId }
      : {}),
    ...(overrides.versionId ? { versionId: overrides.versionId } : {}),
  };
}

function version(overrides: { spaceId?: string } = {}) {
  return {
    id: VERSION_ID,
    name: "M2",
    organizationId: ORGANIZATION_ID,
    spaceId: overrides.spaceId ?? SPACE_ID,
    stats: {
      blockedCount: 0,
      bugCount: 0,
      requirementCount: 0,
      taskCount: 0,
    },
    status: "PLANNED" as const,
  };
}

function requirement(
  overrides: { spaceId?: string; versionId?: string | null } = {},
) {
  return {
    attachments: [],
    contentFormat: "TIPTAP_JSON" as const,
    contentJson: {},
    createdAt: "2026-05-13T00:00:00.000Z",
    id: REQUIREMENT_ID,
    organizationId: ORGANIZATION_ID,
    relatedWorkItems: {
      bugCount: 0,
      bugs: [],
      taskCount: 0,
      tasks: [],
    },
    spaceId: overrides.spaceId ?? SPACE_ID,
    status: "CONFIRMED" as const,
    title: "Requirement",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...(overrides.versionId !== null
      ? { versionId: overrides.versionId ?? VERSION_ID }
      : {}),
  };
}
