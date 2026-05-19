import { describe, expect, it, vi } from "vitest";

vi.mock("@project-delivery/shared", async () =>
  vi.importActual("../../../../../packages/shared/src/index.ts"),
);

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaBugRepository } from "./prisma-bug.repository";

type PrismaCallArgs = {
  where?: unknown;
};

type MockWorkflowState = {
  code: string;
  id: string;
};

function createRepositoryMock(
  input: {
    transactionResult?: unknown[];
    workflowStates?: MockWorkflowState[];
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
  const workflowStateFindMany = vi.fn(
    async () => input.workflowStates ?? [],
  );
  const transaction = vi.fn(
    async () => input.transactionResult ?? [[], 0, [], []],
  );
  const prisma = {
    client: {
      $transaction: transaction,
      workItem: {
        count: workItemCount,
        findMany: workItemFindMany,
        groupBy: workItemGroupBy,
      },
      workflowState: {
        findMany: workflowStateFindMany,
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
    workflowStateFindMany,
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

  it("filters pending regression by explicit workflow state code case-insensitively", async () => {
    const { repository, workItemFindMany } = createRepositoryMock();

    await repository.listBySpaceId("01ARZ3NDEKTSV4RRFFQ69G5SPC", {
      actorUserId: "01ARZ3NDEKTSV4RRFFQ69G5USR",
      lifecycleBucket: "pendingRegression",
      page: 1,
      pageSize: 20,
      visibility: "SPACE",
    });

    const where = workItemFindMany.mock.calls[0]?.[0].where;

    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          {
            currentState: {
              OR: [
                {
                  code: {
                    equals: "PENDING_REGRESSION",
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
        ]),
      }),
    );
    expect(JSON.stringify(where)).not.toContain("VERIFYING");
  });

  it("excludes explicit pending regression state codes from fixing fallback case-insensitively", async () => {
    const { repository, workItemFindMany } = createRepositoryMock();

    await repository.listBySpaceId("01ARZ3NDEKTSV4RRFFQ69G5SPC", {
      actorUserId: "01ARZ3NDEKTSV4RRFFQ69G5USR",
      lifecycleBucket: "fixing",
      page: 1,
      pageSize: 20,
      visibility: "SPACE",
    });

    const where = workItemFindMany.mock.calls[0]?.[0].where as {
      AND?: unknown[];
    };
    const lifecycleWhere = where.AND?.[0];

    expect(lifecycleWhere).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          {
            currentState: {
              OR: [
                {
                  code: {
                    equals: "FIXING",
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
          expect.objectContaining({
            AND: expect.arrayContaining([
              {
                currentState: {
                  NOT: {
                    OR: expect.arrayContaining([
                      {
                        code: {
                          equals: "PENDING_REGRESSION",
                          mode: "insensitive",
                        },
                      },
                    ]),
                  },
                },
              },
              {
                statusCategory: {
                  in: ["IN_PROGRESS", "VERIFYING"],
                },
              },
            ]),
          }),
        ]),
      }),
    );
    expect(JSON.stringify(lifecycleWhere)).not.toContain("notIn");
  });

  it("counts lowercase and mixed-case pending regression states consistently with list rules", async () => {
    const { repository } = createRepositoryMock({
      transactionResult: [
        [],
        0,
        [],
        [
          {
            _count: { _all: 2 },
            currentStateId: "state_verify",
            statusCategory: "VERIFYING",
          },
          {
            _count: { _all: 1 },
            currentStateId: "state_regression_lower",
            statusCategory: "VERIFYING",
          },
          {
            _count: { _all: 3 },
            currentStateId: "state_regression_mixed",
            statusCategory: "VERIFYING",
          },
        ],
      ],
      workflowStates: [
        { code: "qa_verify", id: "state_verify" },
        { code: "pending_regression", id: "state_regression_lower" },
        { code: "PeNdInG_ReGrEsSiOn", id: "state_regression_mixed" },
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

    expect(result.lifecycleBucketCounts).toContainEqual({
      bucket: "fixing",
      count: 2,
    });
    expect(result.lifecycleBucketCounts).toContainEqual({
      bucket: "pendingRegression",
      count: 4,
    });
  });
});
