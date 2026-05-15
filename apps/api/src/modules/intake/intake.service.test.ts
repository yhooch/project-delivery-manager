import { describe, expect, it, vi } from "vitest";

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
    const { service } = createSubject({ role: "VIEWER" });

    await expect(
      service.create(ACTOR_USER_ID, SPACE_ID, {
        title: "New request",
        sourceType: "AD_HOC",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
    });
  });

  it("creates an intake item with actor as reporter after validating references", async () => {
    const { intakeItems, service } = createSubject({ role: "PM" });

    await service.create(ACTOR_USER_ID, SPACE_ID, {
      assigneeId: ASSIGNEE_ID,
      requirementId: REQUIREMENT_ID,
      sourceType: "REQUIREMENT_CHANGE",
      title: "Clarify scope",
      versionId: VERSION_ID,
    });

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
  });

  it("hides a single intake item from non-privileged non-participants", async () => {
    const { service } = createSubject({
      hasParticipant: false,
      role: "DEVELOPER",
    });

    await expect(service.get(ACTOR_USER_ID, INTAKE_ITEM_ID)).rejects.toMatchObject({
      code: "INTAKE_ITEM_NOT_FOUND",
    });
  });

  it("accepts pending intake items and rejects illegal status changes", async () => {
    const { intakeItems, service } = createSubject({
      item: intakeItem({ status: "PENDING" }),
      role: "PM",
    });

    await service.accept(ACTOR_USER_ID, INTAKE_ITEM_ID);

    expect(intakeItems.updateStatus).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      intakeItemId: INTAKE_ITEM_ID,
      status: "ACCEPTED",
    });

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

  it("converts an accepted intake item to one TASK with inherited context", async () => {
    const { intakeItems, service } = createSubject({
      item: intakeItem({
        assigneeId: ASSIGNEE_ID,
        requirementId: REQUIREMENT_ID,
        status: "ACCEPTED",
        versionId: VERSION_ID,
      }),
      role: "PM",
    });

    const result = await service.convertToWorkItems(ACTOR_USER_ID, INTAKE_ITEM_ID, {
      tasks: [
        {
          dueDate: "2026-06-01T00:00:00.000Z",
          title: "Implement converted task",
        },
      ],
    });

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
  role: "SPACE_ADMIN" | "PM" | "DEVELOPER" | "VIEWER";
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
        assigneeId: updateInput.assigneeId ?? item.assigneeId,
        title: updateInput.title ?? item.title,
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

  return {
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
    ),
    spaces,
    versions,
    workItems,
  };
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
    ...(overrides.intakeItemId
      ? { intakeItemId: overrides.intakeItemId }
      : {}),
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

function requirement(overrides: { spaceId?: string } = {}) {
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
  };
}
