import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaWorkflowConfigRepository } from "./prisma-workflow-config.repository";

describe("PrismaWorkflowConfigRepository", () => {
  it("lists workflow versions by workflowDefinitionId", async () => {
    const workflowVersionFindMany = vi.fn(async () => []);
    const workflowVersionCount = vi.fn(async () => 0);
    const prisma = {
      client: {
        $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
          Promise.all(operations),
        ),
        workflowVersion: {
          count: workflowVersionCount,
          findMany: workflowVersionFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaWorkflowConfigRepository(prisma);
    const workflowId = "01H00000000000000000000000";

    await repository.listVersions(workflowId, {
      page: 1,
      pageSize: 20,
    });

    expect(workflowVersionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          workflowDefinitionId: workflowId,
        },
      }),
    );
    expect(workflowVersionCount).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        workflowDefinitionId: workflowId,
      },
    });
  });
});
