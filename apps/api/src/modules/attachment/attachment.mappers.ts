import type { Attachment, AttachmentMimeType } from "@project-delivery/shared";

type PrismaAttachmentRecord = {
  createdAt: Date;
  fileKey: string;
  fileName: string;
  id: string;
  mimeType: string;
  organizationId: string;
  size: number;
  spaceId: string;
  targetId: string;
  targetType: Attachment["targetType"];
  uploadedById: string | null;
};

export function toAttachment(record: PrismaAttachmentRecord): Attachment {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    targetType: record.targetType,
    targetId: record.targetId,
    fileName: record.fileName,
    fileKey: record.fileKey,
    mimeType: record.mimeType as AttachmentMimeType,
    size: record.size,
    uploadedById: record.uploadedById ?? "",
    createdAt: record.createdAt.toISOString(),
  };
}
