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
          "workbench",
          "space-overview",
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

  it("updates comments owned by the current user", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const commentId = ulid();
    const workItemId = ulid();
    const existing = fakeComment(commentId, workItemId, {
      authorId: actorUserId,
      organizationId,
      spaceId,
    });
    const updated = { ...existing, body: "Updated" };
    const comments = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(async () => existing),
      listByTarget: vi.fn(),
      update: vi.fn(async () => updated),
    } as unknown as CommentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        role: "DEVELOPER" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const audit = createAuditService();
    const realtime = createRealtimePublisher();
    const service = new CommentService(comments, targets, audit, realtime);

    await service.update(
      actorUserId,
      commentId,
      { body: "Updated" },
      { requestId: "req-comment-update" },
    );

    expect(comments.update).toHaveBeenCalledWith({
      body: "Updated",
      commentId,
      updatedById: actorUserId,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: actorUserId,
        after: updated,
        before: existing,
        requestId: "req-comment-update",
        targetId: commentId,
        targetType: "COMMENT",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "UPDATED",
        target: { type: "WORK_ITEM", id: workItemId },
        invalidates: expect.arrayContaining(["comments", "timeline"]),
      }),
    );
  });

  it("deletes comments owned by the current user", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const commentId = ulid();
    const workItemId = ulid();
    const existing = fakeComment(commentId, workItemId, {
      authorId: actorUserId,
      organizationId,
      spaceId,
    });
    const comments = {
      create: vi.fn(),
      delete: vi.fn(async () => existing),
      findById: vi.fn(async () => existing),
      listByTarget: vi.fn(),
      update: vi.fn(),
    } as unknown as CommentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        role: "DEVELOPER" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const audit = createAuditService();
    const realtime = createRealtimePublisher();
    const service = new CommentService(comments, targets, audit, realtime);

    await expect(
      service.delete(actorUserId, commentId, {
        requestId: "req-comment-delete",
      }),
    ).resolves.toEqual({});

    expect(comments.delete).toHaveBeenCalledWith({
      commentId,
      deletedById: actorUserId,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "DELETE",
        actorId: actorUserId,
        before: existing,
        requestId: "req-comment-delete",
        targetId: commentId,
        targetType: "COMMENT",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "DELETED",
        target: { type: "WORK_ITEM", id: workItemId },
      }),
    );
  });

  it("rejects comment mutations from non-authors", async () => {
    const actorUserId = ulid();
    const commentId = ulid();
    const workItemId = ulid();
    const existing = fakeComment(commentId, workItemId, {
      authorId: ulid(),
    });
    const comments = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(async () => existing),
      listByTarget: vi.fn(),
      update: vi.fn(),
    } as unknown as CommentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId: existing.organizationId,
        spaceId: existing.spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        role: "DEVELOPER" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const audit = createAuditService();
    const realtime = createRealtimePublisher();
    const service = new CommentService(comments, targets, audit, realtime);

    await expect(
      service.update(actorUserId, commentId, { body: "Updated" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(comments.update).not.toHaveBeenCalled();
    expect(comments.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it("rejects comment mutations from viewer authors", async () => {
    const actorUserId = ulid();
    const commentId = ulid();
    const workItemId = ulid();
    const existing = fakeComment(commentId, workItemId, {
      authorId: actorUserId,
    });
    const comments = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(async () => existing),
      listByTarget: vi.fn(),
      update: vi.fn(),
    } as unknown as CommentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId: existing.organizationId,
        spaceId: existing.spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        role: "VIEWER" as const,
        canWrite: false,
      })),
    } as unknown as TargetResolverService;
    const audit = createAuditService();
    const realtime = createRealtimePublisher();
    const service = new CommentService(comments, targets, audit, realtime);

    await expect(
      service.delete(actorUserId, commentId),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      details: { role: "VIEWER" },
    });
    expect(comments.update).not.toHaveBeenCalled();
    expect(comments.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
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

function fakeComment(
  id: string,
  targetId: string,
  overrides: {
    authorId?: string;
    organizationId?: string;
    spaceId?: string;
  } = {},
): Comment {
  return {
    id,
    organizationId: overrides.organizationId ?? ulid(),
    spaceId: overrides.spaceId ?? ulid(),
    targetType: "WORK_ITEM",
    targetId,
    author: {
      id: overrides.authorId ?? ulid(),
      username: "author",
      name: "Author",
    },
    body: "Looks good",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
