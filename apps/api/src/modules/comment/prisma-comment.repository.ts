import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { toComment } from "./comment.mappers";
import type { CommentRepository } from "./comment.repository";
import type {
  CommentListInput,
  CreateCommentInput,
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
      await tx.timelineEvent.create({
        data: {
          id: input.timelineEventId,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          targetType: input.targetType,
          targetId: input.targetId,
          eventType: "COMMENTED",
          actorId: input.authorId,
          title: "Commented",
          metadata: {
            commentId: input.id,
          },
          createdById: input.authorId,
          updatedById: input.authorId,
        },
      });

      return created;
    });

    return toComment(comment);
  }
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
