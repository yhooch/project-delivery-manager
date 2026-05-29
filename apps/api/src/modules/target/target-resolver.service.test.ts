import { HttpStatus } from "@nestjs/common";
import { ulid } from "ulid";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import type { RequirementRepository } from "../requirement/requirement.repository";
import type { SpaceRepository } from "../space/space.repository";
import { TargetResolverService } from "./target-resolver.service";

describe("TargetResolverService", () => {
  it("allows VIEWER reads but rejects VIEWER writes", async () => {
    const workItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { resolver, spaces, workItemFindFirst } = createResolver();

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      title: "Work item",
    });
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "VIEWER",
      space: {
        id: spaceId,
        organizationId,
        name: "Space",
        code: "SPACE",
        status: "ACTIVE",
        settings: {
          staleThresholdDays: 3,
        },
      },
    });

    await expect(
      resolver.resolve(ulid(), "WORK_ITEM", workItemId),
    ).resolves.toMatchObject({
      canWrite: false,
      role: "VIEWER",
      targetId: workItemId,
      targetType: "WORK_ITEM",
    });

    await expect(
      resolver.resolve(ulid(), "WORK_ITEM", workItemId, {
        access: "write",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
  });

  it("rejects VIEWER writes even when the user is an object participant", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { objectParticipantFindFirst, resolver, spaces, workItemFindFirst } =
      createResolver();

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      title: "Work item",
    });
    objectParticipantFindFirst.mockResolvedValue({ id: ulid() });
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "VIEWER",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId),
    ).resolves.toMatchObject({
      canWrite: false,
      role: "VIEWER",
      targetId: workItemId,
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId, {
        access: "write",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
    expect(objectParticipantFindFirst).not.toHaveBeenCalled();
  });

  it("can hide inaccessible targets behind a caller-specific not found code", async () => {
    const workItemId = ulid();
    const { resolver, spaces, workItemFindFirst } = createResolver();

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId: ulid(),
      spaceId: ulid(),
      title: "Work item",
    });
    vi.mocked(spaces.findAccessibleById).mockResolvedValue(undefined);

    await expect(
      resolver.resolve(ulid(), "WORK_ITEM", workItemId, {
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      }),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_TARGET_NOT_FOUND",
      status: HttpStatus.NOT_FOUND,
    });
  });

  it("hides WORK_ITEM targets from same-space non-participants without read-all roles", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { objectParticipantFindFirst, resolver, spaces, workItemFindFirst } =
      createResolver();

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      title: "Work item",
    });
    objectParticipantFindFirst.mockResolvedValue(undefined);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "DEVELOPER",
      space: {
        id: spaceId,
        organizationId,
        name: "Space",
        code: "SPACE",
        status: "ACTIVE",
        settings: {
          staleThresholdDays: 3,
        },
      },
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId, {
        access: "write",
      }),
    ).rejects.toMatchObject({
      code: "WORK_ITEM_NOT_FOUND",
      status: HttpStatus.NOT_FOUND,
    });
    expect(objectParticipantFindFirst).toHaveBeenCalledWith({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM",
        userId: actorUserId,
      },
    });
  });

  it("allows WORK_ITEM targets for same-space participants", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { objectParticipantFindFirst, resolver, spaces, workItemFindFirst } =
      createResolver();

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      title: "Work item",
    });
    objectParticipantFindFirst.mockResolvedValue({ id: ulid() });
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "DEVELOPER",
      space: {
        id: spaceId,
        organizationId,
        name: "Space",
        code: "SPACE",
        status: "ACTIVE",
        settings: {
          staleThresholdDays: 3,
        },
      },
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId, {
        access: "write",
      }),
    ).resolves.toMatchObject({
      canWrite: true,
      role: "DEVELOPER",
      targetId: workItemId,
      targetType: "WORK_ITEM",
    });
  });

  it("rejects WORK_ITEM tag writes for non-manager participants under object update policy", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { objectParticipantFindFirst, resolver, spaces, workItemFindFirst } =
      createResolver();

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      title: "Work item",
    });
    objectParticipantFindFirst.mockResolvedValue({ id: ulid() });
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "DEVELOPER",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId, {
        access: "write",
        writePolicy: "objectUpdate",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
  });

  it("allows WORK_ITEM tag writes for managers under object update policy", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { objectParticipantFindFirst, resolver, spaces, workItemFindFirst } =
      createResolver();

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      title: "Work item",
    });
    objectParticipantFindFirst.mockResolvedValue(undefined);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "PM",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId, {
        access: "write",
        writePolicy: "objectUpdate",
      }),
    ).resolves.toMatchObject({
      canWrite: true,
      role: "PM",
      targetId: workItemId,
      targetType: "WORK_ITEM",
    });
  });

  it("allows TESTER to read only Bug or testing WORK_ITEM targets without participation", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { objectParticipantFindFirst, resolver, spaces, workItemFindFirst } =
      createResolver();

    objectParticipantFindFirst.mockResolvedValue(undefined);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "TESTER",
      space: makeSpace(spaceId, organizationId),
    });
    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      statusCategory: "NOT_STARTED",
      title: "Task",
      type: "TASK",
      currentState: {
        code: "PENDING",
        name: "待处理",
      },
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId),
    ).rejects.toMatchObject({
      code: "WORK_ITEM_NOT_FOUND",
    });

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      statusCategory: "VERIFYING",
      title: "Task",
      type: "TASK",
      currentState: {
        code: "QA_VERIFY",
        name: "QA verify",
      },
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId),
    ).resolves.toMatchObject({
      canWrite: false,
      role: "TESTER",
      targetId: workItemId,
    });
    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId, {
        access: "write",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
    });
  });

  it("allows PM to write any visible WORK_ITEM without object participation", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { objectParticipantFindFirst, resolver, spaces, workItemFindFirst } =
      createResolver();

    workItemFindFirst.mockResolvedValue({
      id: workItemId,
      organizationId,
      spaceId,
      statusCategory: "NOT_STARTED",
      title: "Task",
      type: "TASK",
      currentState: {
        code: "PENDING",
        name: "待处理",
      },
    });
    objectParticipantFindFirst.mockResolvedValue(undefined);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "PM",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "WORK_ITEM", workItemId, {
        access: "write",
      }),
    ).resolves.toMatchObject({
      canWrite: true,
      role: "PM",
      targetId: workItemId,
    });
  });

  it.each(["SPACE_ADMIN", "PM", "REQUIREMENT"] as const)(
    "allows %s members to read and write DRAFT REQUIREMENT targets",
    async (role) => {
      const actorUserId = ulid();
      const requirementId = ulid();
      const spaceId = ulid();
      const organizationId = ulid();
      const { requirements, resolver, spaces } = createResolver();

      vi.mocked(requirements.findById).mockResolvedValue(
        makeRequirement(requirementId, spaceId, organizationId, "DRAFT"),
      );
      vi.mocked(requirements.isParticipant).mockResolvedValue(false);
      vi.mocked(spaces.findAccessibleById).mockResolvedValue({
        role,
        space: makeSpace(spaceId, organizationId),
      });

      await expect(
        resolver.resolve(actorUserId, "REQUIREMENT", requirementId, {
          access: "write",
          hideInaccessible: true,
          notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
        }),
      ).resolves.toMatchObject({
        canWrite: true,
        targetId: requirementId,
      });

      await expect(
        resolver.resolve(actorUserId, "REQUIREMENT", requirementId, {
          access: "write",
        }),
      ).resolves.toMatchObject({
        canWrite: true,
        targetId: requirementId,
      });

      await expect(
        resolver.resolve(actorUserId, "REQUIREMENT", requirementId),
      ).resolves.toMatchObject({
        canWrite: true,
        targetId: requirementId,
        targetKind: "REQUIREMENT",
        targetType: "DOCUMENT",
      });
      expect(requirements.isParticipant).not.toHaveBeenCalled();
    },
  );

  it("allows DRAFT REQUIREMENT participants to resolve read and write targets", async () => {
    const actorUserId = ulid();
    const requirementId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { requirements, resolver, spaces } = createResolver();

    vi.mocked(requirements.findById).mockResolvedValue(
      makeRequirement(requirementId, spaceId, organizationId, "DRAFT"),
    );
    vi.mocked(requirements.isParticipant).mockResolvedValue(true);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "PM",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId),
    ).resolves.toMatchObject({
      canWrite: true,
      role: "PM",
      targetId: requirementId,
      targetKind: "REQUIREMENT",
      targetType: "DOCUMENT",
    });

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId, {
        access: "write",
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      }),
    ).resolves.toMatchObject({
      canWrite: true,
      targetId: requirementId,
      targetKind: "REQUIREMENT",
      targetType: "DOCUMENT",
    });
  });

  it("allows same-space non-participants to read non-deleted REQUIREMENT targets", async () => {
    const actorUserId = ulid();
    const requirementId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { requirements, resolver, spaces } = createResolver();

    vi.mocked(requirements.findById).mockResolvedValue(
      makeRequirement(requirementId, spaceId, organizationId, "CONFIRMED"),
    );
    vi.mocked(requirements.isParticipant).mockResolvedValue(false);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "DEVELOPER",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId),
    ).resolves.toMatchObject({
      canWrite: false,
      targetId: requirementId,
      targetKind: "REQUIREMENT",
      targetType: "DOCUMENT",
    });

    vi.mocked(requirements.isParticipant).mockResolvedValue(true);

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId),
    ).resolves.toMatchObject({
      targetId: requirementId,
      targetKind: "REQUIREMENT",
      targetType: "DOCUMENT",
    });
  });

  it("uses requirement update semantics for tag writes under object update policy", async () => {
    const actorUserId = ulid();
    const requirementId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { requirements, resolver, spaces } = createResolver();

    vi.mocked(requirements.findById).mockResolvedValue(
      makeRequirement(requirementId, spaceId, organizationId, "CONFIRMED"),
    );
    vi.mocked(requirements.isParticipant).mockResolvedValue(true);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "DEVELOPER",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId, {
        access: "write",
        writePolicy: "objectUpdate",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });

    vi.mocked(requirements.isParticipant).mockResolvedValue(false);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "REQUIREMENT",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId, {
        access: "write",
        writePolicy: "objectUpdate",
      }),
    ).resolves.toMatchObject({
      canWrite: true,
      role: "REQUIREMENT",
      targetId: requirementId,
    });
  });

  it("allows requirement writers to update draft requirement targets without participant membership", async () => {
    const actorUserId = ulid();
    const requirementId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { requirements, resolver, spaces } = createResolver();

    vi.mocked(requirements.findById).mockResolvedValue(
      makeRequirement(requirementId, spaceId, organizationId, "DRAFT"),
    );
    vi.mocked(requirements.isParticipant).mockResolvedValue(false);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "PM",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId, {
        access: "write",
        writePolicy: "objectUpdate",
      }),
    ).resolves.toMatchObject({
      canWrite: true,
      role: "PM",
      targetId: requirementId,
    });
    expect(requirements.isParticipant).not.toHaveBeenCalled();
  });

  it("rejects VIEWER writes to non-draft REQUIREMENT targets even as participant", async () => {
    const actorUserId = ulid();
    const requirementId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { objectParticipantFindFirst, requirements, resolver, spaces } =
      createResolver();

    vi.mocked(requirements.findById).mockResolvedValue(
      makeRequirement(requirementId, spaceId, organizationId, "CONFIRMED"),
    );
    objectParticipantFindFirst.mockResolvedValue({ id: ulid() });
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "VIEWER",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId),
    ).resolves.toMatchObject({
      canWrite: false,
      role: "VIEWER",
      targetId: requirementId,
    });

    await expect(
      resolver.resolve(actorUserId, "REQUIREMENT", requirementId, {
        access: "write",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
    expect(objectParticipantFindFirst).not.toHaveBeenCalled();
  });

  it("hides INTAKE_ITEM targets from same-space non-participants without read-all roles", async () => {
    const actorUserId = ulid();
    const intakeItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const {
      intakeItemFindFirst,
      objectParticipantFindFirst,
      resolver,
      spaces,
    } = createResolver();

    intakeItemFindFirst.mockResolvedValue({
      id: intakeItemId,
      organizationId,
      spaceId,
      title: "Intake",
    });
    objectParticipantFindFirst.mockResolvedValue(undefined);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "DEVELOPER",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "INTAKE_ITEM", intakeItemId),
    ).rejects.toMatchObject({
      code: "INTAKE_ITEM_NOT_FOUND",
    });
  });

  it("rejects INTAKE_ITEM tag writes for non-manager participants under object update policy", async () => {
    const actorUserId = ulid();
    const intakeItemId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const {
      intakeItemFindFirst,
      objectParticipantFindFirst,
      resolver,
      spaces,
    } = createResolver();

    intakeItemFindFirst.mockResolvedValue({
      id: intakeItemId,
      organizationId,
      spaceId,
      title: "Intake",
    });
    objectParticipantFindFirst.mockResolvedValue({ id: ulid() });
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "DEVELOPER",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(actorUserId, "INTAKE_ITEM", intakeItemId, {
        access: "write",
        writePolicy: "objectUpdate",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
  });

  it("allows read-only roles to read draft requirements", async () => {
    const requirementId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { requirements, resolver, spaces } = createResolver();

    vi.mocked(requirements.findById).mockResolvedValue(
      makeRequirement(requirementId, spaceId, organizationId, "DRAFT"),
    );
    vi.mocked(requirements.isParticipant).mockResolvedValue(false);
    vi.mocked(spaces.findAccessibleById).mockResolvedValue({
      role: "VIEWER",
      space: makeSpace(spaceId, organizationId),
    });

    await expect(
      resolver.resolve(ulid(), "REQUIREMENT", requirementId),
    ).resolves.toMatchObject({
      canWrite: false,
      role: "VIEWER",
      targetId: requirementId,
      targetKind: "REQUIREMENT",
      targetType: "DOCUMENT",
    });
  });
});

function createResolver() {
  const intakeItemFindFirst = vi.fn();
  const objectParticipantFindFirst = vi.fn();
  const workItemFindFirst = vi.fn();
  const prisma = {
    client: {
      intakeItem: {
        findFirst: intakeItemFindFirst,
      },
      space: {
        findFirst: vi.fn(),
      },
      version: {
        findFirst: vi.fn(),
      },
      objectParticipant: {
        findFirst: objectParticipantFindFirst,
      },
      workItem: {
        findFirst: workItemFindFirst,
      },
    },
  } as unknown as PrismaService;
  const requirements = {
    archive: vi.fn(),
    createDraft: vi.fn(),
    findById: vi.fn(),
    isParticipant: vi.fn(),
    listBySpaceId: vi.fn(),
    save: vi.fn(),
  } as unknown as RequirementRepository;
  const spaces = {
    addMember: vi.fn(),
    createWithAdmin: vi.fn(),
    findAccessibleById: vi.fn(),
    findByCode: vi.fn(),
    findCurrentVersion: vi.fn(),
    findMemberById: vi.fn(),
    findMemberByUserId: vi.fn(),
    listByOrganizationId: vi.fn(),
    listDefaultWorkflows: vi.fn(),
    listMembers: vi.fn(),
    update: vi.fn(),
    updateMember: vi.fn(),
  } as unknown as SpaceRepository;

  return {
    intakeItemFindFirst,
    prisma,
    objectParticipantFindFirst,
    requirements,
    resolver: new TargetResolverService(prisma, requirements, spaces),
    spaces,
    workItemFindFirst,
  };
}

function makeSpace(spaceId: string, organizationId: string) {
  return {
    id: spaceId,
    organizationId,
    name: "Space",
    code: "SPACE",
    status: "ACTIVE" as const,
    settings: {
      staleThresholdDays: 3,
    },
  };
}

function makeRequirement(
  requirementId: string,
  spaceId: string,
  organizationId: string,
  status: "CONFIRMED" | "DRAFT",
) {
  const currentStatus: "ACTIVE" | "DRAFT" =
    status === "CONFIRMED" ? "ACTIVE" : status;

  return {
    id: requirementId,
    organizationId,
    spaceId,
    kind: "REQUIREMENT" as const,
    title: status === "DRAFT" ? "" : "Requirement",
    contentJson: {},
    contentFormat: "TIPTAP_JSON" as const,
    status: currentStatus,
    relatedWorkItems: {
      taskCount: 0,
      bugCount: 0,
      tasks: [],
      bugs: [],
    },
    tags: [],
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
  };
}
