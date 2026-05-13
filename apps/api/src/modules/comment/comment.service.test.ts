import type { Comment } from "@project-delivery/shared";
import { ulid } from "ulid";
import { describe, expect, it, vi } from "vitest";

import type { TargetResolverService } from "../target/target-resolver.service";
import type { CommentRepository } from "./comment.repository";
import { CommentService } from "./comment.service";

describe("CommentService", () => {
  it("creates a comment through a writable resolved target", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const comments = {
      create: vi.fn(async (input) => fakeComment(input.id, workItemId)),
      listByTarget: vi.fn(),
    } as unknown as CommentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        title: "Task",
        role: "DEVELOPER" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const service = new CommentService(comments, targets);

    await service.create(actorUserId, {
      targetType: "WORK_ITEM",
      targetId: workItemId,
      body: "Looks good",
    });

    expect(targets.resolve).toHaveBeenCalledWith(
      actorUserId,
      "WORK_ITEM",
      workItemId,
      {
        access: "write",
      },
    );
    expect(comments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: actorUserId,
        body: "Looks good",
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM",
      }),
    );
  });
});

function fakeComment(id: string, targetId: string): Comment {
  return {
    id,
    organizationId: ulid(),
    spaceId: ulid(),
    targetType: "WORK_ITEM",
    targetId,
    author: {
      id: ulid(),
      username: "author",
      name: "Author",
    },
    body: "Looks good",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
