import { describe, expect, it, vi } from "vitest";

vi.mock("@project-delivery/shared", async () =>
  vi.importActual("../../../../../packages/shared/src/index.ts"),
);

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaWorkItemRepository } from "./prisma-workitem.repository";

const SPACE_ID = "01H00000000000000000000001";
const WORKFLOW_VERSION_ID = "01H00000000000000000000002";
const CURRENT_STATE_ID = "01H00000000000000000000003";
const ACTOR_ID = "01H00000000000000000000004";
const TAG_ID = "01H00000000000000000000005";
const SECOND_TAG_ID = "01H00000000000000000000006";
const FIRST_TAGGED_TASK_ID = "01H00000000000000000000007";
const SECOND_TAGGED_TASK_ID = "01H00000000000000000000008";

describe("PrismaWorkItemRepository", () => {
  it("resolves explicit TASK workflow versions through a workflow binding", async () => {
    const workflowBindingFindFirst = vi.fn();
    const workflowVersionFindFirst = vi.fn(async () => ({
      id: WORKFLOW_VERSION_ID,
      states: [
        {
          category: "IN_PROGRESS",
          id: CURRENT_STATE_ID,
        },
      ],
    }));
    const repository = new PrismaWorkItemRepository({
      client: {
        workflowBinding: {
          findFirst: workflowBindingFindFirst,
        },
        workflowVersion: {
          findFirst: workflowVersionFindFirst,
        },
      },
    } as unknown as PrismaService);

    await expect(
      repository.resolveTaskWorkflow(SPACE_ID, WORKFLOW_VERSION_ID),
    ).resolves.toEqual({
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "IN_PROGRESS",
      workflowVersionId: WORKFLOW_VERSION_ID,
    });
    expect(workflowVersionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: WORKFLOW_VERSION_ID,
          workflowDefinition: expect.objectContaining({
            bindings: {
              some: expect.objectContaining({
                spaceId: SPACE_ID,
                targetType: "WORK_ITEM",
                workItemType: "TASK",
              }),
            },
            spaceId: SPACE_ID,
            status: "ACTIVE",
          }),
        }),
      }),
    );
    expect(workflowBindingFindFirst).not.toHaveBeenCalled();
  });

  it("applies tag filters to task list and status bucket counts", async () => {
    const tagAssignmentFindMany = vi.fn(async () => [
      { tagId: TAG_ID, targetId: FIRST_TAGGED_TASK_ID },
      { tagId: SECOND_TAG_ID, targetId: FIRST_TAGGED_TASK_ID },
      { tagId: TAG_ID, targetId: SECOND_TAGGED_TASK_ID },
    ]);
    const workItemFindMany = vi.fn(async () => []);
    const workItemCount = vi.fn(async () => 0);
    const workItemGroupBy = vi.fn(async () => [
      {
        _count: { _all: 2 },
        statusCategory: "IN_PROGRESS",
      },
    ]);
    const repository = new PrismaWorkItemRepository({
      client: {
        $transaction: vi.fn(async (operations) => Promise.all(operations)),
        tagAssignment: {
          findMany: tagAssignmentFindMany,
        },
        workItem: {
          count: workItemCount,
          findMany: workItemFindMany,
          groupBy: workItemGroupBy,
        },
      },
    } as unknown as PrismaService);

    const result = await repository.listBySpaceId(SPACE_ID, {
      actorUserId: ACTOR_ID,
      page: 1,
      pageSize: 20,
      statusCategory: "DONE",
      tagIds: `${TAG_ID},${SECOND_TAG_ID}`,
      tagMatch: "ANY",
      visibility: "SPACE",
    });

    expect(result.statusCategoryCounts).toEqual([
      {
        count: 2,
        statusCategory: "IN_PROGRESS",
      },
    ]);
    expect(tagAssignmentFindMany).toHaveBeenCalledWith({
      select: {
        tagId: true,
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId: SPACE_ID,
        tag: {
          deletedAt: null,
          spaceId: SPACE_ID,
        },
        tagId: {
          in: [TAG_ID, SECOND_TAG_ID],
        },
        targetType: "WORK_ITEM",
      },
    });
    expect(workItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              id: {
                in: [FIRST_TAGGED_TASK_ID, SECOND_TAGGED_TASK_ID],
              },
            },
          ],
          spaceId: SPACE_ID,
          statusCategory: "DONE",
          type: "TASK",
        }),
      }),
    );
    expect(workItemCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            id: {
              in: [FIRST_TAGGED_TASK_ID, SECOND_TAGGED_TASK_ID],
            },
          },
        ],
        statusCategory: "DONE",
      }),
    });
    expect(workItemGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              id: {
                in: [FIRST_TAGGED_TASK_ID, SECOND_TAGGED_TASK_ID],
              },
            },
          ],
          spaceId: SPACE_ID,
          statusCategory: undefined,
          type: "TASK",
        }),
      }),
    );
  });
});
