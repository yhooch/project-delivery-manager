import { Inject, Injectable } from "@nestjs/common";
import type {
  Comment,
  CommentTargetType,
  CreateCommentRequestSchema,
  PageResult,
} from "@project-delivery/shared";
import { ulid } from "ulid";
import type { z } from "zod";

import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { TargetResolverService } from "../target/target-resolver.service";
import {
  COMMENT_REPOSITORY,
  type CommentRepository,
} from "./comment.repository";

type CreateCommentRequestInput = z.infer<typeof CreateCommentRequestSchema>;

@Injectable()
export class CommentService {
  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly comments: CommentRepository,
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
    @Inject(AuditService)
    private readonly audit: AuditService,
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
      {
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

    return created;
  }
}
