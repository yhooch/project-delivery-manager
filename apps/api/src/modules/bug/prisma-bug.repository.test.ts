import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaBugRepository } from "./prisma-bug.repository";

describe("PrismaBugRepository", () => {
  it("filters pending regression by explicit workflow state semantics", async () => {
    const workItemFindMany = vi.fn((args) => ({ args, kind: "findMany" }));
    const workItemCount = vi.fn((args) => ({ args, kind: "count" }));
    const workItemGroupBy = vi.fn((args) => ({ args, kind: "groupBy" }));
    const workflowStateFindMany = vi.fn(async () => []);
    const transaction = vi.fn(async () => [[], 0, [], []]);
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
      },
    } as unknown as PrismaService;

    const repository = new PrismaBugRepository(prisma);

    await repository.listBySpaceId("01ARZ3NDEKTSV4RRFFQ69G5SPC", {
      actorUserId: "01ARZ3NDEKTSV4RRFFQ69G5USR",
      lifecycleBucket: "pendingRegression",
      page: 1,
      pageSize: 20,
      visibility: "SPACE",
    });

    const where = JSON.stringify(workItemFindMany.mock.calls[0]?.[0].where);

    expect(where).toContain("PENDING_REGRESSION");
    expect(where).not.toContain("VERIFYING");
  });

  it("does not count VERIFYING bugs as pending regression without explicit state code", async () => {
    const workItemFindMany = vi.fn((args) => ({ args, kind: "findMany" }));
    const workItemCount = vi.fn((args) => ({ args, kind: "count" }));
    const workItemGroupBy = vi.fn((args) => ({ args, kind: "groupBy" }));
    const workflowStateFindMany = vi.fn(async () => [
      { code: "QA_VERIFY", id: "state_verify" },
      { code: "PENDING_REGRESSION", id: "state_regression" },
    ]);
    const prisma = {
      client: {
        $transaction: vi.fn(async () => [
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
              currentStateId: "state_regression",
              statusCategory: "VERIFYING",
            },
          ],
        ]),
        workItem: {
          count: workItemCount,
          findMany: workItemFindMany,
          groupBy: workItemGroupBy,
        },
        workflowState: {
          findMany: workflowStateFindMany,
        },
      },
    } as unknown as PrismaService;

    const repository = new PrismaBugRepository(prisma);

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
      count: 1,
    });
  });
});
