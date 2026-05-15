import type {
  AttachmentTargetType,
  PageResult,
  Attachment,
} from "@project-delivery/shared";

import type {
  AttachmentLookupResult,
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
  countByTarget(
    targetType: AttachmentTargetType,
    targetId: string,
  ): Promise<number>;
  create(input: CreateAttachmentInput): Promise<NonNullable<AttachmentLookupResult>>;
  findById(attachmentId: string): Promise<AttachmentLookupResult>;
  listByTarget(input: {
    page: number;
    pageSize: number;
    targetId: string;
    targetType: AttachmentTargetType;
  }): Promise<PageResult<Attachment>>;
};
