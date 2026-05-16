import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  AttachmentDownloadUrlExpiresInSeconds,
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  AttachmentMimeTypeSchema,
  PresignedUploadUrlExpiresInSeconds,
  type Attachment,
  type AttachmentMimeType,
  type AttachmentTargetType,
  type CreateAttachmentRequest,
  type GetAttachmentDownloadUrlResponse,
  type PageResult,
  type PresignAttachmentRequest,
  type PresignAttachmentResponse,
  type SpaceRole,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import {
  REQUIREMENT_REPOSITORY,
  type RequirementRepository,
} from "../requirement/requirement.repository";
import { TargetResolverService } from "../target/target-resolver.service";
import {
  AttachmentLimitExceededError,
  AttachmentTargetNotFoundError,
  ATTACHMENT_REPOSITORY,
  type AttachmentRepository,
} from "./attachment.repository";
import type { AttachmentTargetContext } from "./attachment.types";
import {
  ATTACHMENT_OBJECT_STORAGE,
  type AttachmentObjectMetadata,
  type AttachmentObjectStorage,
} from "./storage/attachment-object-storage";

const REQUIREMENT_WRITER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);

@Injectable()
export class AttachmentService {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY)
    private readonly attachments: AttachmentRepository,
    @Inject(REQUIREMENT_REPOSITORY)
    private readonly requirements: RequirementRepository,
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(ATTACHMENT_OBJECT_STORAGE)
    private readonly objectStorage: AttachmentObjectStorage,
  ) {}

  async presign(
    actorUserId: string,
    input: PresignAttachmentRequest,
  ): Promise<PresignAttachmentResponse> {
    this.assertFileConstraints(input);
    await this.requireWritableAttachmentTarget(actorUserId, input);
    await this.assertAttachmentCountLimit(input.targetType, input.targetId);

    const fileKey = createFileKey(
      input.targetType,
      input.targetId,
      input.fileName,
    );
    const uploadUrl = await this.objectStorage.createPresignedUploadUrl({
      expiresInSeconds: PresignedUploadUrlExpiresInSeconds,
      key: fileKey,
      mimeType: input.mimeType,
    });

    return {
      uploadUrl,
      fileKey,
      expiresInSeconds: PresignedUploadUrlExpiresInSeconds,
    };
  }

  async create(
    actorUserId: string,
    input: CreateAttachmentRequest,
    metadata: RequestMetadata = {},
  ): Promise<Attachment> {
    const file = this.assertFileConstraints(input);
    if (!isExpectedFileKey(input.targetType, input.targetId, input.fileKey)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "fileKey does not match attachment target",
        HttpStatus.BAD_REQUEST,
      );
    }

    const target = await this.requireWritableAttachmentTarget(
      actorUserId,
      input,
    );
    await this.assertAttachmentCountLimit(input.targetType, input.targetId);
    await this.assertUploadedObjectMatches(input);

    const created = await this.createAttachmentOrThrowPublicError({
      id: ulid(),
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetType: input.targetType,
      targetId: input.targetId,
      fileName: input.fileName,
      fileKey: input.fileKey,
      mimeType: file.mimeType,
      size: input.size,
      uploadedById: actorUserId,
    });

    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created,
      metadata: {
        fileName: input.fileName,
        mimeType: file.mimeType,
        size: input.size,
        targetId: input.targetId,
        targetType: input.targetType,
      },
      ...metadata,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetId: created.id,
      targetType: "ATTACHMENT",
    });

    return created;
  }

  async list(
    actorUserId: string,
    input: {
      page: number;
      pageSize: number;
      targetId: string;
      targetType: AttachmentTargetType;
    },
  ): Promise<PageResult<Attachment>> {
    const target = await this.requireReadableAttachmentTarget(
      actorUserId,
      input,
    );

    return this.attachments.listByTarget({
      page: input.page,
      pageSize: input.pageSize,
      targetId: target.targetId,
      targetType: target.targetType,
    });
  }

  async getDownloadUrl(
    actorUserId: string,
    attachmentId: string,
  ): Promise<GetAttachmentDownloadUrlResponse> {
    const attachment = await this.attachments.findById(attachmentId);

    if (!attachment) {
      throwAttachmentTargetNotFound();
    }

    await this.requireReadableAttachmentTarget(actorUserId, {
      targetId: attachment.targetId,
      targetType: attachment.targetType,
    });

    const downloadUrl = await this.objectStorage.createPresignedDownloadUrl({
      expiresInSeconds: AttachmentDownloadUrlExpiresInSeconds,
      key: attachment.fileKey,
    });

    return {
      downloadUrl,
      expiresInSeconds: AttachmentDownloadUrlExpiresInSeconds,
    };
  }

  private async requireWritableDraftRequirementTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: "REQUIREMENT";
    },
  ): Promise<AttachmentTargetContext> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
      {
        access: "write",
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      },
    );
    const requirement = await this.requirements.findById(target.targetId);

    if (!requirement) {
      throwAttachmentTargetNotFound();
    }
    if (!REQUIREMENT_WRITER_ROLES.has(target.role)) {
      throwSpaceAccessDenied();
    }
    if (requirement.status !== "DRAFT") {
      throw new ApiException(
        "DRAFT_REQUIREMENT_REQUIRED",
        "Only draft requirements can receive new attachments",
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetType: "REQUIREMENT",
      targetId: target.targetId,
    };
  }

  private async requireWritableAttachmentTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: AttachmentTargetType;
    },
  ): Promise<AttachmentTargetContext> {
    if (input.targetType === "REQUIREMENT") {
      return this.requireWritableDraftRequirementTarget(actorUserId, {
        targetId: input.targetId,
        targetType: "REQUIREMENT",
      });
    }

    return this.requireWritableResolvedAttachmentTarget(actorUserId, {
      targetId: input.targetId,
      targetType: "WORK_ITEM",
    });
  }

  private async requireReadableAttachmentTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: AttachmentTargetType;
    },
  ): Promise<AttachmentTargetContext> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
      {
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      },
    );

    return {
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetType: input.targetType,
      targetId: target.targetId,
    };
  }

  private async requireWritableResolvedAttachmentTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: AttachmentTargetType;
    },
  ): Promise<AttachmentTargetContext> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
      {
        access: "write",
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      },
    );

    return {
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetType: input.targetType,
      targetId: target.targetId,
    };
  }

  private async assertAttachmentCountLimit(
    targetType: AttachmentTargetType,
    targetId: string,
  ) {
    const count = await this.attachments.countByTarget(targetType, targetId);

    if (count >= AttachmentMaxCountPerTarget) {
      throwAttachmentLimitExceeded();
    }
  }

  private async createAttachmentOrThrowPublicError(
    input: Parameters<AttachmentRepository["create"]>[0],
  ) {
    try {
      return await this.attachments.create(input);
    } catch (error) {
      if (error instanceof AttachmentLimitExceededError) {
        throwAttachmentLimitExceeded();
      }
      if (error instanceof AttachmentTargetNotFoundError) {
        throwAttachmentTargetNotFound();
      }

      throw error;
    }
  }

  private assertFileConstraints(input: { mimeType: string; size: number }): {
    mimeType: AttachmentMimeType;
  } {
    if (!Number.isInteger(input.size)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Attachment size must be an integer",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (input.size <= 0) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Attachment size must be positive",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (input.size > AttachmentMaxSizeBytes) {
      throw new ApiException(
        "FILE_TOO_LARGE",
        "Attachment size exceeds the allowed limit",
        HttpStatus.BAD_REQUEST,
      );
    }
    const mimeType = AttachmentMimeTypeSchema.safeParse(input.mimeType);

    if (!mimeType.success) {
      throw new ApiException(
        "UNSUPPORTED_MIME_TYPE",
        "Attachment MIME type is not allowed",
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      mimeType: mimeType.data,
    };
  }

  private async assertUploadedObjectMatches(
    input: CreateAttachmentRequest,
  ): Promise<void> {
    const object = await this.objectStorage.statObject(input.fileKey);

    if (!object) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Uploaded attachment object does not exist",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (object.size !== input.size) {
      await this.deleteInvalidUploadedObject(input.fileKey);
      throw new ApiException(
        "VALIDATION_ERROR",
        "Uploaded attachment size does not match registration",
        HttpStatus.BAD_REQUEST,
        {
          actualSize: object.size,
          expectedSize: input.size,
        },
      );
    }
    if (!mimeTypesMatch(object, input.mimeType)) {
      await this.deleteInvalidUploadedObject(input.fileKey);
      throw new ApiException(
        "VALIDATION_ERROR",
        "Uploaded attachment MIME type does not match registration",
        HttpStatus.BAD_REQUEST,
        {
          actualMimeType: object.mimeType,
          expectedMimeType: input.mimeType,
        },
      );
    }
  }

  private async deleteInvalidUploadedObject(fileKey: string): Promise<void> {
    try {
      await this.objectStorage.deleteObjectIfExists(fileKey);
    } catch (error) {
      void error;
    }
  }
}

function createFileKey(
  targetType: "REQUIREMENT" | "WORK_ITEM",
  targetId: string,
  fileName: string,
): string {
  return `attachments/${targetType.toLowerCase()}/${targetId}/${ulid()}-${sanitizeFileName(fileName)}`;
}

function isExpectedFileKey(
  targetType: "REQUIREMENT" | "WORK_ITEM",
  targetId: string,
  fileKey: string,
): boolean {
  const prefix = `attachments/${targetType.toLowerCase()}/${targetId}/`;

  if (!fileKey.startsWith(prefix)) {
    return false;
  }

  const objectName = fileKey.slice(prefix.length);

  return /^[0-9A-HJKMNP-TV-Z]{26}-.+$/u.test(objectName);
}

function mimeTypesMatch(
  object: AttachmentObjectMetadata,
  expected: string,
): boolean {
  return normalizeMimeType(object.mimeType) === normalizeMimeType(expected);
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[/\\]/gu, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return sanitized || "file";
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function throwAttachmentTargetNotFound(): never {
  throw new ApiException(
    "ATTACHMENT_TARGET_NOT_FOUND",
    "Attachment target not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwAttachmentLimitExceeded(): never {
  throw new ApiException(
    "ATTACHMENT_LIMIT_EXCEEDED",
    "Attachment count limit exceeded",
    HttpStatus.BAD_REQUEST,
  );
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}
