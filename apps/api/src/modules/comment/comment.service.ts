import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  Comment,
  CommentTargetType,
  CreateCommentRequestSchema,
  PageResult,
  RealtimeInvalidationKey,
  UpdateCommentRequestSchema,
  WorkItemType,
} from "@project-delivery/shared";
import { ulid } from "ulid";
import type { z } from "zod";

import { ApiException } from "../../http/api-exception";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import {
  legacyRequirementRealtimeHints,
  withDocumentRecentActivityInvalidates,
  withDocumentRequirementInvalidates,
} from "../target/legacy-target-normalizer";
import { TargetResolverService } from "../target/target-resolver.service";
import {
  COMMENT_REPOSITORY,
  type CommentRepository,
} from "./comment.repository";

type CreateCommentRequestInput = z.infer<typeof CreateCommentRequestSchema>;
type UpdateCommentRequestInput = z.infer<typeof UpdateCommentRequestSchema>;
type MutableCommentContext = {
  comment: Comment;
  targetKind?: "REQUIREMENT";
  targetWorkItemType?: WorkItemType;
};

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly comments: CommentRepository,
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
  ) {}

  async list(
    actorUserId: string,
    input: {
      page: number;
      pageSize: number;
      targetId: string;
      targetType: CommentTargetType;
    },
  ): Promise<PageResult<Comment>> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
    );

    return this.comments.listByTarget({
      organizationId: target.organizationId,
      page: input.page,
      pageSize: input.pageSize,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: input.targetType,
    });
  }

  async create(
    actorUserId: string,
    input: CreateCommentRequestInput,
    metadata: RequestMetadata = {},
  ): Promise<Comment> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
      input.targetType === "DOCUMENT"
        ? {}
        : {
            access: "write",
            audit: {
              ...metadata,
              operation: "createComment",
            },
          },
    );

    const created = await this.comments.create({
      id: ulid(),
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetType: input.targetType,
      targetId: target.targetId,
      targetWorkItemType: target.workItemType,
      authorId: actorUserId,
      body: input.body,
      timelineEventId: ulid(),
    });

    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created,
      metadata: {
        targetId: target.targetId,
        targetType: input.targetType,
      },
      ...metadata,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetId: created.id,
      targetType: "COMMENT",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      target: { type: input.targetType, id: target.targetId },
      operation: "COMMENTED",
      invalidates: commentInvalidates(
        input.targetType,
        target.workItemType,
        target.targetKind === "REQUIREMENT" ? "REQUIREMENT" : undefined,
      ),
      hints: legacyRequirementRealtimeHints({
        targetType: target.targetType,
        targetId: target.targetId,
        targetKind:
          target.targetKind === "REQUIREMENT" ? "REQUIREMENT" : undefined,
        spaceId: target.spaceId,
        workItemType: target.workItemType,
      }),
    });

    return created;
  }

  async validateMutation(actorUserId: string, commentId: string): Promise<Comment> {
    return (await this.requireMutableComment(actorUserId, commentId)).comment;
  }

  async update(
    actorUserId: string,
    commentId: string,
    input: UpdateCommentRequestInput,
    metadata: RequestMetadata = {},
  ): Promise<Comment> {
    const existingContext = await this.requireMutableComment(
      actorUserId,
      commentId,
    );
    const existing = existingContext.comment;
    const updated = await this.comments.update({
      body: input.body,
      commentId,
      updatedById: actorUserId,
    });

    if (!updated) {
      throwCommentNotFound();
    }

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: updated,
      before: existing,
      metadata: {
        targetId: existing.targetId,
        targetType: existing.targetType,
      },
      ...metadata,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: existing.id,
      targetType: "COMMENT",
    });

    this.publishCommentRealtime(actorUserId, updated, "UPDATED", existingContext);

    return updated;
  }

  async delete(
    actorUserId: string,
    commentId: string,
    metadata: RequestMetadata = {},
  ): Promise<Record<string, never>> {
    const existingContext = await this.requireMutableComment(
      actorUserId,
      commentId,
    );
    const existing = existingContext.comment;
    const deleted = await this.comments.delete({
      commentId,
      deletedById: actorUserId,
    });

    if (!deleted) {
      throwCommentNotFound();
    }

    await this.audit.record({
      actionType: "DELETE",
      actorId: actorUserId,
      before: existing,
      metadata: {
        targetId: existing.targetId,
        targetType: existing.targetType,
      },
      ...metadata,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: existing.id,
      targetType: "COMMENT",
    });

    this.publishCommentRealtime(actorUserId, existing, "DELETED", existingContext);

    return {};
  }

  private async requireMutableComment(
    actorUserId: string,
    commentId: string,
  ): Promise<MutableCommentContext> {
    const comment = await this.comments.findById(commentId);

    if (!comment) {
      throwCommentNotFound();
    }

    const target = await this.targets.resolve(
      actorUserId,
      comment.targetType,
      comment.targetId,
    );

    if (comment.author.id !== actorUserId) {
      throw new ApiException(
        "FORBIDDEN",
        "Only the comment author can modify this comment.",
        HttpStatus.FORBIDDEN,
      );
    }

    if (target.role === "VIEWER") {
      throw new ApiException(
        "SPACE_ACCESS_DENIED",
        "Space access denied",
        HttpStatus.FORBIDDEN,
        { role: target.role },
      );
    }

    return {
      comment,
      targetKind: target.targetKind === "REQUIREMENT" ? "REQUIREMENT" : undefined,
      targetWorkItemType: target.workItemType,
    };
  }

  private publishCommentRealtime(
    actorUserId: string,
    comment: Comment,
    operation: "UPDATED" | "DELETED",
    context?: MutableCommentContext,
  ) {
    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: comment.organizationId,
      spaceId: comment.spaceId,
      target: { type: comment.targetType, id: comment.targetId },
      operation,
      invalidates: commentInvalidates(
        comment.targetType,
        context?.targetWorkItemType,
        context?.targetKind,
      ),
      hints: legacyRequirementRealtimeHints({
        targetType: comment.targetType,
        targetId: comment.targetId,
        targetKind: context?.targetKind,
        spaceId: comment.spaceId,
        workItemType: context?.targetWorkItemType,
      }),
    });
  }

  private safePublishRealtime(
    input: Parameters<RealtimePublisherService["publish"]>[0],
  ) {
    try {
      this.realtime.publish(input);
    } catch (error) {
      this.logger.error(
        "Failed to publish comment realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function throwCommentNotFound(): never {
  throw new ApiException("NOT_FOUND", "Comment not found", HttpStatus.NOT_FOUND);
}

function commentInvalidates(
  targetType: CommentTargetType,
  workItemType: WorkItemType | undefined,
  targetKind?: "REQUIREMENT",
): RealtimeInvalidationKey[] {
  switch (targetType) {
    case "DOCUMENT":
      return withDocumentRecentActivityInvalidates(
        targetType,
        withDocumentRequirementInvalidates(
          targetType,
          ["comments", "timeline", "document-comments", "document-timeline"],
          ["requirement-detail"],
          targetKind,
        ),
        targetKind,
      );
    case "INTAKE_ITEM":
      return ["comments", "timeline", "intake-list"];
    case "WORK_ITEM":
      return [
        "comments",
        "timeline",
        workItemType === "BUG" ? "bug-list" : "work-item-list",
        "version-board",
        "workbench",
        "space-overview",
      ];
  }
}
