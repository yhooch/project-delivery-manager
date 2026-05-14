import { HttpStatus } from "@nestjs/common";
import { ulid } from "ulid";
import { describe, expect, it, vi } from "vitest";

import { ApiException } from "../../http/api-exception";
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

  it("hides draft requirements from read-only roles", async () => {
    const requirementId = ulid();
    const spaceId = ulid();
    const organizationId = ulid();
    const { requirements, resolver, spaces } = createResolver();

    vi.mocked(requirements.findById).mockResolvedValue({
      id: requirementId,
      organizationId,
      spaceId,
      title: "",
      contentJson: {},
      contentFormat: "TIPTAP_JSON",
      status: "DRAFT",
      relatedWorkItems: {
        taskCount: 0,
        bugCount: 0,
        tasks: [],
        bugs: [],
      },
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
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
      resolver.resolve(ulid(), "REQUIREMENT", requirementId),
    ).rejects.toBeInstanceOf(ApiException);
  });
});

function createResolver() {
  const objectParticipantFindFirst = vi.fn();
  const workItemFindFirst = vi.fn();
  const prisma = {
    client: {
      intakeItem: {
        findFirst: vi.fn(),
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
    getOverviewStats: vi.fn(),
    listByOrganizationId: vi.fn(),
    listDefaultWorkflows: vi.fn(),
    listMembers: vi.fn(),
    update: vi.fn(),
    updateMember: vi.fn(),
  } as unknown as SpaceRepository;

  return {
    prisma,
    objectParticipantFindFirst,
    requirements,
    resolver: new TargetResolverService(prisma, requirements, spaces),
    spaces,
    workItemFindFirst,
  };
}
