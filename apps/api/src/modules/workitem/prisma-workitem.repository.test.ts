import { describe, expect, it, vi } from "vitest";

vi.mock("@project-delivery/shared", async () =>
  vi.importActual("../../../../../packages/shared/src/index.ts"),
);

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaWorkItemRepository } from "./prisma-workitem.repository";

const SPACE_ID = "01H00000000000000000000001";
const WORKFLOW_VERSION_ID = "01H00000000000000000000002";
const CURRENT_STATE_ID = "01H00000000000000000000003";

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
});
