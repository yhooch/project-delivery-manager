import { Inject, Injectable } from "@nestjs/common";
import type { AttachmentTargetType } from "@project-delivery/shared";

import { PrismaService } from "../../prisma/prisma.service";
import { toAttachment } from "./attachment.mappers";
import type { AttachmentRepository } from "./attachment.repository";
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
    const attachment = await this.prisma.client.attachment.create({
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
}
