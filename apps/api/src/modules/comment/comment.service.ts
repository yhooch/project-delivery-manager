import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  Comment,
  CommentTargetType,
  CreateCommentRequestSchema,
  PageResult,
  RealtimeInvalidationKey,
  WorkItemType,
} from "@project-delivery/shared";
import { ulid } from "ulid";
import type { z } from "zod";

import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import {
  legacyRequirementRealtimeHints,
  withDocumentRequirementInvalidates,
} from "../target/legacy-target-normalizer";
import { TargetResolverService } from "../target/target-resolver.service";
import {
  COMMENT_REPOSITORY,
  type CommentRepository,
} from "./comment.repository";

type CreateCommentRequestInput = z.infer<typeof CreateCommentRequestSchema>;

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

function commentInvalidates(
  targetType: CommentTargetType,
  workItemType: WorkItemType | undefined,
  targetKind?: "REQUIREMENT",
): RealtimeInvalidationKey[] {
  switch (targetType) {
    case "DOCUMENT":
      return withDocumentRequirementInvalidates(
        targetType,
        ["comments", "timeline", "document-comments", "document-timeline"],
        ["requirement-detail"],
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
