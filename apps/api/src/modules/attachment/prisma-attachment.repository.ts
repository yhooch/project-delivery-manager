import { Inject, Injectable } from "@nestjs/common";
import {
  AttachmentMaxCountPerTarget,
  type AttachmentTargetType,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { toAttachment } from "./attachment.mappers";
import {
  AttachmentLimitExceededError,
  type AttachmentRepository,
} from "./attachment.repository";
import type { CreateAttachmentInput } from "./attachment.types";

@Injectable()
export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async countByTarget(targetType: AttachmentTargetType, targetId: string) {
    return this.prisma.client.attachment.count({
      where: {
        deletedAt: null,
        targetId,
        targetType,
      },
    });
  }

  async create(input: CreateAttachmentInput) {
    const attachment = await this.prisma.client.$transaction(async (tx) => {
      await lockAttachmentTarget(tx, input.targetType, input.targetId);
      const currentCount = await tx.attachment.count({
        where: {
          deletedAt: null,
          targetId: input.targetId,
          targetType: input.targetType,
        },
      });

      if (currentCount >= AttachmentMaxCountPerTarget) {
        throw new AttachmentLimitExceededError();
      }

      const created = await tx.attachment.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          targetType: input.targetType,
          targetId: input.targetId,
          fileName: input.fileName,
          fileKey: input.fileKey,
          mimeType: input.mimeType,
          size: input.size,
          uploadedById: input.uploadedById,
          createdById: input.uploadedById,
          updatedById: input.uploadedById,
        },
      });

      await tx.timelineEvent.create({
        data: {
          id: ulid(),
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          targetType: input.targetType,
          targetId: input.targetId,
          eventType: "ATTACHMENT_ADDED",
          actorId: input.uploadedById,
          title: "Attachment added",
          metadata: {
            attachmentId: input.id,
            fileName: input.fileName,
            fileKey: input.fileKey,
            mimeType: input.mimeType,
            size: input.size,
          } satisfies Prisma.InputJsonObject,
          createdById: input.uploadedById,
          updatedById: input.uploadedById,
        },
      });

      return created;
    });

    return toAttachment(attachment);
  }

  async findById(attachmentId: string) {
    const attachment = await this.prisma.client.attachment.findFirst({
      where: {
        deletedAt: null,
        id: attachmentId,
      },
    });

    return attachment ? toAttachment(attachment) : undefined;
  }

  async listByTarget(input: {
    page: number;
    pageSize: number;
    targetId: string;
    targetType: AttachmentTargetType;
  }) {
    const where = {
      deletedAt: null,
      targetId: input.targetId,
      targetType: input.targetType,
    };
    const [attachments, total] = await this.prisma.client.$transaction([
      this.prisma.client.attachment.findMany({
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.attachment.count({
        where,
      }),
    ]);

    return {
      items: attachments.map((attachment) => toAttachment(attachment)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }
}

async function lockAttachmentTarget(
  tx: Prisma.TransactionClient,
  targetType: AttachmentTargetType,
  targetId: string,
) {
  if (targetType === "WORK_ITEM") {
    await tx.$queryRaw`
      SELECT id
      FROM work_items
      WHERE id = ${targetId}
        AND deleted_at IS NULL
      FOR UPDATE
    `;
    return;
  }

  await tx.$queryRaw`
    SELECT id
    FROM requirements
    WHERE id = ${targetId}
      AND deleted_at IS NULL
    FOR UPDATE
  `;
}
