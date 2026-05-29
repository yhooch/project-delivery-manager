import { Inject, Injectable } from "@nestjs/common";
import {
  AttachmentMaxCountPerTarget,
  type AttachmentTargetType,
} from "@project-delivery/shared";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import { toAttachment } from "./attachment.mappers";
import {
  AttachmentLimitExceededError,
  AttachmentTargetNotFoundError,
  type AttachmentRepository,
} from "./attachment.repository";
import type {
  AttachmentTargetContext,
  CreateAttachmentInput,
} from "./attachment.types";

@Injectable()
export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async countByTarget(target: AttachmentTargetContext) {
    return this.prisma.client.attachment.count({
      where: {
        deletedAt: null,
        organizationId: target.organizationId,
        spaceId: target.spaceId,
        targetId: target.targetId,
        targetType: target.targetType,
      },
    });
  }

  async create(input: CreateAttachmentInput) {
    const attachment = await this.prisma.client.$transaction(async (tx) => {
      const targetExists = await lockAttachmentTarget(
        tx,
        input.targetType,
        input.targetId,
        input.organizationId,
        input.spaceId,
      );

      if (!targetExists) {
        throw new AttachmentTargetNotFoundError();
      }

      const currentCount = await tx.attachment.count({
        where: {
          deletedAt: null,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
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

      await createTimelineEventRecord(tx, {
        actorUserId: input.uploadedById,
        eventType: "ATTACHMENT_ADDED",
        metadata: {
          attachmentId: input.id,
          fileName: input.fileName,
          fileKey: input.fileKey,
          mimeType: input.mimeType,
          size: input.size,
        },
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
        targetWorkItemType: input.targetWorkItemType,
        title: "Attachment added",
      });

      return created;
    });

    return toAttachment(attachment);
  }

  async findById(input: AttachmentTargetContext & { attachmentId: string }) {
    const attachment = await this.prisma.client.attachment.findFirst({
      where: {
        deletedAt: null,
        id: input.attachmentId,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });

    return attachment ? toAttachment(attachment) : undefined;
  }

  async findTargetContextById(
    attachmentId: string,
  ): Promise<AttachmentTargetContext | undefined> {
    const attachment = await this.prisma.client.attachment.findFirst({
      select: {
        organizationId: true,
        spaceId: true,
        targetId: true,
        targetType: true,
      },
      where: {
        deletedAt: null,
        id: attachmentId,
      },
    });

    return attachment ?? undefined;
  }

  async listByTarget(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    spaceId: string;
    targetId: string;
    targetType: AttachmentTargetType;
  }) {
    const where = {
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
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
  organizationId: string,
  spaceId: string,
): Promise<boolean> {
  if (targetType === "WORK_ITEM") {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM work_items
      WHERE id = ${targetId}
        AND organization_id = ${organizationId}
        AND space_id = ${spaceId}
        AND deleted_at IS NULL
      FOR UPDATE
    `;
    return rows.length > 0;
  }

  if (targetType === "DOCUMENT") {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM documents
      WHERE id = ${targetId}
        AND organization_id = ${organizationId}
        AND space_id = ${spaceId}
        AND deleted_at IS NULL
      FOR UPDATE
    `;
    return rows.length > 0;
  }

  return false;
}
