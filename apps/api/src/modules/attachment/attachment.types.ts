import type {
  Attachment,
  AttachmentMimeType,
  AttachmentTargetType,
  WorkItemType,
} from "@project-delivery/shared";

export type AttachmentTargetContext = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetKind?: "REQUIREMENT";
  targetType: AttachmentTargetType;
  targetWorkItemType?: WorkItemType;
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
  targetWorkItemType?: WorkItemType;
  uploadedById: string;
};

export type AttachmentLookupResult = Attachment | undefined;
