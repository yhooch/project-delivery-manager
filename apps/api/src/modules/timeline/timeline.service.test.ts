import { ulid } from "ulid";
import { describe, expect, it, vi } from "vitest";

import type { TargetResolverService } from "../target/target-resolver.service";
import type { TimelineRepository } from "./timeline.repository";
import { TimelineService } from "./timeline.service";

describe("TimelineService", () => {
  it("resolves work item timeline targets before listing events", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const timelines = {
      create: vi.fn(),
      listByTarget: vi.fn(async (input) => ({
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      })),
    } as unknown as TimelineRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        title: "Task",
        role: "PM" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const service = new TimelineService(timelines, targets);

    await service.listWorkItem(actorUserId, workItemId, {
      page: 2,
      pageSize: 10,
    });

    expect(targets.resolve).toHaveBeenCalledWith(
      actorUserId,
      "WORK_ITEM",
      workItemId,
    );
    expect(timelines.listByTarget).toHaveBeenCalledWith({
      organizationId,
      page: 2,
      pageSize: 10,
      spaceId,
      targetId: workItemId,
      targetTitle: "Task",
      targetType: "WORK_ITEM",
    });
  });
});
