import type {
  AttachmentTargetType,
  PageResult,
  Attachment,
} from "@project-delivery/shared";

import type {
  AttachmentLookupResult,
  AttachmentTargetContext,
  CreateAttachmentInput,
} from "./attachment.types";

export const ATTACHMENT_REPOSITORY = Symbol("ATTACHMENT_REPOSITORY");

export class AttachmentLimitExceededError extends Error {
  constructor() {
    super("Attachment count limit exceeded");
  }
}

export class AttachmentTargetNotFoundError extends Error {
  constructor() {
    super("Attachment target not found");
  }
}

export type AttachmentRepository = {
  countByTarget(target: AttachmentTargetContext): Promise<number>;
  create(
    input: CreateAttachmentInput,
  ): Promise<NonNullable<AttachmentLookupResult>>;
  findById(
    input: AttachmentTargetContext & { attachmentId: string },
  ): Promise<AttachmentLookupResult>;
  findTargetContextById(
    attachmentId: string,
  ): Promise<AttachmentTargetContext | undefined>;
  listByTarget(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    spaceId: string;
    targetId: string;
    targetType: AttachmentTargetType;
  }): Promise<PageResult<Attachment>>;
};
