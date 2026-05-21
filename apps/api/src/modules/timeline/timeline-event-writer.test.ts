import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "../../generated/prisma/client";
import {
  createTimelineEventRecord,
  normalizeTimelineMetadata,
} from "./timeline-event-writer";

describe("timeline event writer", () => {
  it("adds target work item type and changed fields without duplicating before/after", async () => {
    const create = vi.fn(async () => undefined);
    const tx = {
      timelineEvent: {
        create,
      },
    } as unknown as Prisma.TransactionClient;

    await createTimelineEventRecord(tx, {
      actorUserId: "01H00000000000000000000001",
      after: {
        assigneeId: "01H00000000000000000000002",
        priority: "HIGH",
      },
      before: {
        assigneeId: null,
        priority: "LOW",
      },
      eventType: "UPDATED",
      organizationId: "01H00000000000000000000003",
      spaceId: "01H00000000000000000000004",
      targetId: "01H00000000000000000000005",
      targetType: "WORK_ITEM",
      targetWorkItemType: "TASK",
      title: "更新任务",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: {
          assigneeId: "01H00000000000000000000002",
          priority: "HIGH",
        },
        before: {
          assigneeId: null,
          priority: "LOW",
        },
        metadata: {
          changedFields: ["assigneeId", "priority"],
          targetWorkItemType: "TASK",
        },
        targetType: "WORK_ITEM",
      }),
    });
  });

  it("keeps explicit metadata for comment and attachment events", () => {
    expect(
      normalizeTimelineMetadata({
        metadata: {
          attachmentId: "01H00000000000000000000006",
          commentId: "01H00000000000000000000007",
          commentPreview: "Looks good",
          fileName: "spec.pdf",
          mimeType: "application/pdf",
          size: 1024,
        },
        targetWorkItemType: "BUG",
      }),
    ).toEqual({
      attachmentId: "01H00000000000000000000006",
      commentId: "01H00000000000000000000007",
      commentPreview: "Looks good",
      fileName: "spec.pdf",
      mimeType: "application/pdf",
      size: 1024,
      targetWorkItemType: "BUG",
    });
  });
});
