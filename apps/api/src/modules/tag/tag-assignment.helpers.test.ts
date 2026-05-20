import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  findTaggedTargetIds,
  replaceTagAssignmentsInTransaction,
} from "./tag-assignment.helpers";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const TARGET_ID = "01H00000000000000000000003";
const TAG_ID = "01H00000000000000000000004";
const SECOND_TAG_ID = "01H00000000000000000000005";
const THIRD_TAG_ID = "01H00000000000000000000006";

describe("tag assignment helpers", () => {
  it("replaces target tags by soft deleting removed tags, restoring deleted tags, and creating new assignments", async () => {
    const tagAssignmentUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tagAssignmentUpdate = vi.fn(async () => undefined);
    const tagAssignmentCreate = vi.fn(async () => undefined);
    const tx = {
      tag: {
        findMany: vi.fn(async () => [
          makeTag({ id: TAG_ID, name: "Zulu", normalizedName: "zulu" }),
          makeTag({
            id: SECOND_TAG_ID,
            name: "Alpha",
            normalizedName: "alpha",
          }),
          makeTag({
            id: THIRD_TAG_ID,
            name: "Middle",
            normalizedName: "middle",
          }),
        ]),
      },
      tagAssignment: {
        create: tagAssignmentCreate,
        findMany: vi.fn(async () => [
          makeAssignment({ deletedAt: new Date("2026-05-19T00:00:00.000Z") }),
          makeAssignment({ id: "assignment-2", tagId: SECOND_TAG_ID }),
        ]),
        update: tagAssignmentUpdate,
        updateMany: tagAssignmentUpdateMany,
      },
    };

    const result = await replaceTagAssignmentsInTransaction(tx as never, {
      assignedById: ACTOR_ID,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      tagIds: [TAG_ID, SECOND_TAG_ID, THIRD_TAG_ID],
      targetId: TARGET_ID,
      targetType: "WORK_ITEM",
    });

    expect(result.map((tag) => tag.id)).toEqual([
      SECOND_TAG_ID,
      THIRD_TAG_ID,
      TAG_ID,
    ]);
    expect(tagAssignmentUpdateMany).toHaveBeenCalledWith({
      data: {
        deletedAt: expect.any(Date),
      },
      where: expect.objectContaining({
        tagId: {
          notIn: [TAG_ID, SECOND_TAG_ID, THIRD_TAG_ID],
        },
        targetId: TARGET_ID,
        targetType: "WORK_ITEM",
      }),
    });
    expect(tagAssignmentUpdate).toHaveBeenCalledWith({
      data: {
        assignedById: ACTOR_ID,
        deletedAt: null,
      },
      where: {
        id: "assignment-1",
      },
    });
    expect(tagAssignmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignedById: ACTOR_ID,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        tagId: THIRD_TAG_ID,
        targetId: TARGET_ID,
        targetType: "WORK_ITEM",
      }),
    });
  });

  it("rejects missing, deleted, or cross-space tags before changing assignments", async () => {
    const tagAssignmentUpdateMany = vi.fn();
    const tx = {
      tag: {
        findMany: vi.fn(async () => [makeTag({ id: TAG_ID })]),
      },
      tagAssignment: {
        updateMany: tagAssignmentUpdateMany,
      },
    };

    await expect(
      replaceTagAssignmentsInTransaction(tx as never, {
        assignedById: ACTOR_ID,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        tagIds: [TAG_ID, SECOND_TAG_ID],
        targetId: TARGET_ID,
        targetType: "REQUIREMENT",
      }),
    ).rejects.toMatchObject({
      code: "TAG_NOT_FOUND",
      status: HttpStatus.NOT_FOUND,
    });
    expect(tagAssignmentUpdateMany).not.toHaveBeenCalled();
  });

  it("finds tagged target ids with ANY and ALL semantics", async () => {
    const tagAssignmentFindMany = vi.fn(async () => [
      { targetId: "target-1", tagId: TAG_ID },
      { targetId: "target-1", tagId: SECOND_TAG_ID },
      { targetId: "target-2", tagId: TAG_ID },
    ]);
    const client = {
      tagAssignment: {
        findMany: tagAssignmentFindMany,
      },
    };

    await expect(
      findTaggedTargetIds(client as never, {
        spaceId: SPACE_ID,
        tagIds: `${TAG_ID},${SECOND_TAG_ID}`,
        tagMatch: "ANY",
        targetType: "INTAKE_ITEM",
      }),
    ).resolves.toEqual(["target-1", "target-2"]);

    await expect(
      findTaggedTargetIds(client as never, {
        spaceId: SPACE_ID,
        tagIds: `${TAG_ID},${SECOND_TAG_ID}`,
        tagMatch: "ALL",
        targetType: "INTAKE_ITEM",
      }),
    ).resolves.toEqual(["target-1"]);
  });
});

function makeTag(
  input: {
    id?: string;
    name?: string;
    normalizedName?: string;
  } = {},
) {
  const name = input.name ?? "Backend";

  return {
    id: input.id ?? TAG_ID,
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    name,
    normalizedName: input.normalizedName ?? name.toLocaleLowerCase("en-US"),
    colorKey: "blue",
    createdAt: new Date("2026-05-19T00:00:00.000Z"),
    updatedAt: new Date("2026-05-19T00:00:00.000Z"),
  };
}

function makeAssignment(
  input: {
    deletedAt?: Date | null;
    id?: string;
    tagId?: string;
  } = {},
) {
  return {
    id: input.id ?? "assignment-1",
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    tagId: input.tagId ?? TAG_ID,
    targetType: "WORK_ITEM" as const,
    targetId: TARGET_ID,
    assignedById: ACTOR_ID,
    createdAt: new Date("2026-05-19T00:00:00.000Z"),
    updatedAt: new Date("2026-05-19T00:00:00.000Z"),
    deletedAt: input.deletedAt ?? null,
  };
}
