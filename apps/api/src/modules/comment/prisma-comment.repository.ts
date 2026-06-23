import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import { toComment } from "./comment.mappers";
import type { CommentRepository } from "./comment.repository";
import type {
  CommentListInput,
  CreateCommentInput,
  DeleteCommentInput,
  UpdateCommentInput,
} from "./comment.types";

@Injectable()
export class PrismaCommentRepository implements CommentRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listByTarget(input: CommentListInput) {
    const where: Prisma.CommentWhereInput = {
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: input.targetType,
    };
    const [comments, total] = await this.prisma.client.$transaction([
      this.prisma.client.comment.findMany({
        include: {
          author: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.comment.count({
        where,
      }),
    ]);

    return {
      items: comments.map((comment) => toComment(comment)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async findById(commentId: string) {
    const comment = await this.prisma.client.comment.findFirst({
      include: {
        author: true,
      },
      where: {
        deletedAt: null,
        id: commentId,
      },
    });

    return comment ? toComment(comment) : undefined;
  }

  async create(input: CreateCommentInput) {
    const comment = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          targetType: input.targetType,
          targetId: input.targetId,
          authorId: input.authorId,
          body: input.body,
          createdById: input.authorId,
          updatedById: input.authorId,
        },
        include: {
          author: true,
        },
      });

      await ensureCommenterParticipant(tx, input);
      await createTimelineEventRecord(tx, {
        actorUserId: input.authorId,
        eventType: "COMMENTED",
        id: input.timelineEventId,
        metadata: {
          commentId: input.id,
          commentPreview: previewComment(input.body) || undefined,
        },
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
        targetWorkItemType: input.targetWorkItemType,
        title: "Commented",
      });

      return created;
    });

    return toComment(comment);
  }

  async update(input: UpdateCommentInput) {
    const existing = await this.prisma.client.comment.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        id: input.commentId,
      },
    });

    if (!existing) {
      return undefined;
    }

    const comment = await this.prisma.client.comment.update({
      data: {
        body: input.body,
        updatedById: input.updatedById,
      },
      include: {
        author: true,
      },
      where: {
        id: existing.id,
      },
    });

    return toComment(comment);
  }

  async delete(input: DeleteCommentInput) {
    const existing = await this.prisma.client.comment.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        id: input.commentId,
      },
    });

    if (!existing) {
      return undefined;
    }

    const comment = await this.prisma.client.comment.update({
      data: {
        deletedAt: new Date(),
        updatedById: input.deletedById,
      },
      include: {
        author: true,
      },
      where: {
        id: existing.id,
      },
    });

    return toComment(comment);
  }
}

function previewComment(body: string) {
  return body.trim().replace(/\s+/gu, " ").slice(0, 120);
}

async function ensureCommenterParticipant(
  tx: Prisma.TransactionClient,
  input: CreateCommentInput,
) {
  const existing = await tx.objectParticipant.findFirst({
    select: {
      id: true,
    },
    where: {
      deletedAt: null,
      relationType: "COMMENTER",
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: input.targetType,
      userId: input.authorId,
    },
  });

  if (existing) {
    return;
  }

  await tx.objectParticipant.create({
    data: {
      id: ulid(),
      createdById: input.authorId,
      organizationId: input.organizationId,
      relationType: "COMMENTER",
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: input.targetType,
      updatedById: input.authorId,
      userId: input.authorId,
    },
  });
}
