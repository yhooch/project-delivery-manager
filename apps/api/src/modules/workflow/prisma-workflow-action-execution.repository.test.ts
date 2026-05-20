import { describe, expect, it, vi } from "vitest";

vi.mock("@project-delivery/shared", async () =>
  vi.importActual("../../../../../packages/shared/src/index.ts"),
);

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaWorkflowActionExecutionRepository } from "./prisma-workflow-action-execution.repository";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const WORK_ITEM_ID = "01H00000000000000000000003";
const WORKFLOW_VERSION_ID = "01H00000000000000000000004";
const PENDING_STATE_ID = "01H00000000000000000000005";
const IN_PROGRESS_STATE_ID = "01H00000000000000000000006";
const TAG_ID = "01H00000000000000000000007";

describe("PrismaWorkflowActionExecutionRepository", () => {
  it("preserves assigned tags when updating workflow state", async () => {
    const now = new Date("2026-05-20T00:00:00.000Z");
    const tag = makeTag();
    const workItemUpdateMany = vi.fn(async () => ({ count: 1 }));
    const workItemFindFirst = vi.fn(async () =>
      makeWorkItemRecord({
        currentStateId: IN_PROGRESS_STATE_ID,
        lastActionAt: now,
        lastStatusChangedAt: now,
        statusCategory: "IN_PROGRESS",
      }),
    );
    const tagAssignmentFindMany = vi.fn(async () => [
      {
        tag,
        targetId: WORK_ITEM_ID,
      },
    ]);
    const txClient = {
      tagAssignment: {
        findMany: tagAssignmentFindMany,
      },
      workItem: {
        findFirst: workItemFindFirst,
        updateMany: workItemUpdateMany,
      },
    };
    const transaction = vi.fn(async (handler) => handler(txClient));
    const repository = new PrismaWorkflowActionExecutionRepository({
      client: {
        $transaction: transaction,
      },
    } as unknown as PrismaService);

    const result = await repository.transaction((tx) =>
      tx.updateWorkItemState({
        actorUserId: ACTOR_ID,
        currentStateId: IN_PROGRESS_STATE_ID,
        expectedCurrentStateId: PENDING_STATE_ID,
        lastActionAt: now,
        lastStatusChangedAt: now,
        statusCategory: "IN_PROGRESS",
        workItemId: WORK_ITEM_ID,
      }),
    );

    expect(result?.tags).toEqual([
      {
        colorKey: "blue",
        createdAt: tag.createdAt.toISOString(),
        displayName: "#Backend",
        id: TAG_ID,
        name: "Backend",
        normalizedName: "backend",
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        updatedAt: tag.updatedAt.toISOString(),
      },
    ]);
    expect(tagAssignmentFindMany).toHaveBeenCalledWith({
      include: {
        tag: true,
      },
      where: {
        deletedAt: null,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        tag: {
          deletedAt: null,
          organizationId: ORGANIZATION_ID,
          spaceId: SPACE_ID,
        },
        targetId: {
          in: [WORK_ITEM_ID],
        },
        targetType: "WORK_ITEM",
      },
    });
  });
});

function makeWorkItemRecord(
  overrides: {
    currentStateId?: string;
    lastActionAt?: Date | null;
    lastStatusChangedAt?: Date;
    statusCategory?: "NOT_STARTED" | "IN_PROGRESS";
  } = {},
) {
  return {
    assigneeId: ACTOR_ID,
    blockedAt: null,
    blockedReason: null,
    bugDetail: null,
    closedAt: null,
    createdById: ACTOR_ID,
    currentStateId: overrides.currentStateId ?? PENDING_STATE_ID,
    description: null,
    dueDate: null,
    id: WORK_ITEM_ID,
    intakeItemId: null,
    lastActionAt: overrides.lastActionAt ?? null,
    lastStatusChangedAt:
      overrides.lastStatusChangedAt ?? new Date("2026-05-19T00:00:00.000Z"),
    organizationId: ORGANIZATION_ID,
    priority: "MEDIUM",
    reporterId: ACTOR_ID,
    requirementId: null,
    spaceId: SPACE_ID,
    statusCategory: overrides.statusCategory ?? "NOT_STARTED",
    title: "Existing task",
    type: "TASK",
    versionId: null,
    workflowVersionId: WORKFLOW_VERSION_ID,
  };
}

function makeTag() {
  return {
    colorKey: "blue",
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    id: TAG_ID,
    name: "Backend",
    normalizedName: "backend",
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    updatedAt: new Date("2026-05-18T00:00:00.000Z"),
  };
}
