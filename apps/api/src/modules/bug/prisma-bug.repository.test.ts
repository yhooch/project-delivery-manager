import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaBugRepository } from "./prisma-bug.repository";

type PrismaCallArgs = {
  where?: unknown;
};

function createRepositoryMock(
  input: {
    transactionResult?: unknown[];
    workflowVersion?: unknown;
  } = {},
) {
  const workflowBindingFindFirst = vi.fn();
  const workflowVersionFindFirst = vi.fn(
    async () => input.workflowVersion,
  );
  const workItemFindMany = vi.fn((args: PrismaCallArgs) => ({
    args,
    kind: "findMany",
  }));
  const workItemCount = vi.fn((args: PrismaCallArgs) => ({
    args,
    kind: "count",
  }));
  const workItemGroupBy = vi.fn((args: PrismaCallArgs) => ({
    args,
    kind: "groupBy",
  }));
  const transaction = vi.fn(
    async (_queries: unknown[]) => input.transactionResult ?? [[], 0, []],
  );
  const prisma = {
    client: {
      $transaction: transaction,
      workItem: {
        count: workItemCount,
        findMany: workItemFindMany,
        groupBy: workItemGroupBy,
      },
      workflowBinding: {
        findFirst: workflowBindingFindFirst,
      },
      workflowVersion: {
        findFirst: workflowVersionFindFirst,
      },
    },
  } as unknown as PrismaService;

  return {
    repository: new PrismaBugRepository(prisma),
    transaction,
    workItemCount,
    workItemFindMany,
    workItemGroupBy,
    workflowBindingFindFirst,
    workflowVersionFindFirst,
  };
}

describe("PrismaBugRepository", () => {
  it("resolves explicit BUG workflow versions through a workflow binding", async () => {
    const { repository, workflowBindingFindFirst, workflowVersionFindFirst } =
      createRepositoryMock({
        workflowVersion: {
          id: "01H00000000000000000000002",
          states: [
            {
              category: "VERIFYING",
              id: "01H00000000000000000000003",
            },
          ],
        },
      });

    await expect(
      repository.resolveBugWorkflow(
        "01H00000000000000000000001",
        "01H00000000000000000000002",
      ),
    ).resolves.toEqual({
      currentStateId: "01H00000000000000000000003",
      statusCategory: "VERIFYING",
      workflowVersionId: "01H00000000000000000000002",
    });
    expect(workflowVersionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "01H00000000000000000000002",
          workflowDefinition: expect.objectContaining({
            bindings: {
              some: expect.objectContaining({
                spaceId: "01H00000000000000000000001",
                targetType: "WORK_ITEM",
                workItemType: "BUG",
              }),
            },
            spaceId: "01H00000000000000000000001",
            status: "ACTIVE",
          }),
        }),
      }),
    );
    expect(workflowBindingFindFirst).not.toHaveBeenCalled();
  });

  it("returns status category counts without lifecycle bucket aggregation", async () => {
    const { repository, transaction, workItemGroupBy } = createRepositoryMock({
      transactionResult: [
        [],
        0,
        [
          {
            _count: { _all: 3 },
            statusCategory: "DONE",
          },
          {
            _count: { _all: 2 },
            statusCategory: "VERIFYING",
          },
        ],
      ],
    });

    const result = await repository.listBySpaceId(
      "01ARZ3NDEKTSV4RRFFQ69G5SPC",
      {
        actorUserId: "01ARZ3NDEKTSV4RRFFQ69G5USR",
        page: 1,
        pageSize: 20,
        visibility: "SPACE",
      },
    );

    expect(result.statusCategoryCounts).toEqual([
      { count: 3, statusCategory: "DONE" },
      { count: 2, statusCategory: "VERIFYING" },
    ]);
    expect(transaction.mock.calls[0]?.[0]).toHaveLength(3);
    expect(workItemGroupBy).toHaveBeenCalledTimes(1);
  });
});
