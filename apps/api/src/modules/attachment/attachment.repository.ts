import type {
  AttachmentTargetType,
} from "@project-delivery/shared";

import type {
  AttachmentLookupResult,
  CreateAttachmentInput,
} from "./attachment.types";

export const ATTACHMENT_REPOSITORY = Symbol("ATTACHMENT_REPOSITORY");

export type AttachmentRepository = {
  countByTarget(
    targetType: AttachmentTargetType,
    targetId: string,
  ): Promise<number>;
  create(input: CreateAttachmentInput): Promise<NonNullable<AttachmentLookupResult>>;
  findById(attachmentId: string): Promise<AttachmentLookupResult>;
};
