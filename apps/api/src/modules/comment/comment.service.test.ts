import type { Comment } from "@project-delivery/shared";
import { ulid } from "ulid";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
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
    const audit = createAuditService();
    const realtime = createRealtimePublisher();
    const service = new CommentService(comments, targets, audit, realtime);

    await service.create(
      actorUserId,
      {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        body: "Looks good",
      },
      { requestId: "req-comment" },
    );

    expect(targets.resolve).toHaveBeenCalledWith(
      actorUserId,
      "WORK_ITEM",
      workItemId,
      expect.objectContaining({
        access: "write",
      }),
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
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: actorUserId,
        metadata: {
          targetId: workItemId,
          targetType: "WORK_ITEM",
        },
        organizationId,
        requestId: "req-comment",
        spaceId,
        targetType: "COMMENT",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "COMMENTED",
        target: { type: "WORK_ITEM", id: workItemId },
        invalidates: expect.arrayContaining(["comments", "timeline"]),
        hints: expect.objectContaining({
          targetId: workItemId,
          targetType: "WORK_ITEM",
        }),
      }),
    );
  });

  it("does not create comments when WORK_ITEM visibility resolution rejects", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const comments = {
      create: vi.fn(),
      listByTarget: vi.fn(),
    } as unknown as CommentRepository;
    const targets = {
      resolve: vi.fn(async () => {
        throw new Error("not visible");
      }),
    } as unknown as TargetResolverService;
    const audit = createAuditService();
    const realtime = createRealtimePublisher();
    const service = new CommentService(comments, targets, audit, realtime);

    await expect(
      service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        body: "Looks good",
      }),
    ).rejects.toThrow("not visible");
    expect(comments.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it("publishes requirement document hints for requirement comments", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const requirementId = ulid();
    const comments = {
      create: vi.fn(async (input) => fakeComment(input.id, requirementId)),
      listByTarget: vi.fn(),
    } as unknown as CommentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: requirementId,
        targetKind: "REQUIREMENT" as const,
        targetType: "DOCUMENT" as const,
        role: "PM" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const audit = createAuditService();
    const realtime = createRealtimePublisher();
    const service = new CommentService(comments, targets, audit, realtime);

    await service.create(actorUserId, {
      targetType: "DOCUMENT",
      targetId: requirementId,
      body: "Looks good",
    });

    expect(comments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: requirementId,
        targetType: "DOCUMENT",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: "DOCUMENT", id: requirementId },
        invalidates: expect.arrayContaining([
          "requirement-detail",
          "document-comments",
          "document-timeline",
        ]),
        hints: expect.objectContaining({
          canonicalTargetType: "DOCUMENT",
          requirementId,
          targetId: requirementId,
          targetKind: "REQUIREMENT",
          targetType: "DOCUMENT",
        }),
      }),
    );
  });
});

function createAuditService() {
  return {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
  };
}

function createRealtimePublisher() {
  return {
    publish: vi.fn(),
  } as unknown as RealtimePublisherService & {
    publish: ReturnType<typeof vi.fn>;
  };
}

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
