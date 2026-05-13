import type {
  Attachment,
  AttachmentMimeType,
  AttachmentTargetType,
} from "@project-delivery/shared";

export type AttachmentTargetContext = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: AttachmentTargetType;
};

export type CreateAttachmentInput = {
  id: string;
  organizationId: string;
  spaceId: string;
  targetType: AttachmentTargetType;
  targetId: string;
  fileName: string;
  fileKey: string;
  mimeType: AttachmentMimeType;
  size: number;
  uploadedById: string;
};

export type AttachmentLookupResult = Attachment | undefined;
