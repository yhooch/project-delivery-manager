import { createHmac, timingSafeEqual } from "node:crypto";

import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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

import { DEFAULT_ATTACHMENT_OBJECT_STORAGE_ORIGIN } from "../../config/env";
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
    @Optional()
    @Inject(ConfigService)
    private readonly config?: ConfigService,
  ) {}

  async presign(
    actorUserId: string,
    input: PresignAttachmentRequest,
  ): Promise<PresignAttachmentResponse> {
    this.assertFileConstraints(input);
    await this.requireWritableAttachmentTarget(actorUserId, input);
    await this.assertAttachmentCountLimit(input.targetType, input.targetId);

    const fileKey = createSignedFileKey(actorUserId, input);

    return {
      uploadUrl: createObjectUrl(
        "upload",
        fileKey,
        PresignedUploadUrlExpiresInSeconds,
        this.objectStorageOrigin(),
      ),
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
    assertSignedFileKey(actorUserId, input);

    const target = await this.requireWritableAttachmentTarget(
      actorUserId,
      input,
    );
    await this.assertAttachmentCountLimit(input.targetType, input.targetId);

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

    return {
      downloadUrl: createObjectUrl(
        "download",
        attachment.fileKey,
        AttachmentDownloadUrlExpiresInSeconds,
        this.objectStorageOrigin(),
      ),
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

  private objectStorageOrigin(): string {
    return (
      this.config?.get<string>("ATTACHMENT_OBJECT_STORAGE_ORIGIN") ??
      DEFAULT_ATTACHMENT_OBJECT_STORAGE_ORIGIN
    );
  }
}

function createFileKey(
  targetType: "REQUIREMENT" | "WORK_ITEM",
  targetId: string,
  fileName: string,
): string {
  return `attachments/${targetType.toLowerCase()}/${targetId}/${ulid()}-${sanitizeFileName(fileName)}`;
}

function createSignedFileKey(
  actorUserId: string,
  input: PresignAttachmentRequest,
): string {
  const unsignedFileKey = createFileKey(
    input.targetType,
    input.targetId,
    input.fileName,
  );
  const expiresAt = Date.now() + PresignedUploadUrlExpiresInSeconds * 1000;
  const signature = signFileKey(actorUserId, {
    expiresAt,
    fileKey: unsignedFileKey,
    mimeType: input.mimeType,
    size: input.size,
    targetId: input.targetId,
    targetType: input.targetType,
  });

  return `${unsignedFileKey}~${expiresAt}~${signature}`;
}

function isExpectedFileKey(
  targetType: "REQUIREMENT" | "WORK_ITEM",
  targetId: string,
  fileKey: string,
): boolean {
  return fileKey.startsWith(
    `attachments/${targetType.toLowerCase()}/${targetId}/`,
  );
}

function assertSignedFileKey(
  actorUserId: string,
  input: CreateAttachmentRequest,
): void {
  const signedFileKey = parseSignedFileKey(input.fileKey);

  if (!signedFileKey) {
    throwInvalidFileKeySignature();
  }
  if (Date.now() > signedFileKey.expiresAt) {
    throw new ApiException(
      "VALIDATION_ERROR",
      "Presigned attachment registration has expired",
      HttpStatus.BAD_REQUEST,
    );
  }

  const expectedSignature = signFileKey(actorUserId, {
    expiresAt: signedFileKey.expiresAt,
    fileKey: signedFileKey.unsignedFileKey,
    mimeType: input.mimeType,
    size: input.size,
    targetId: input.targetId,
    targetType: input.targetType,
  });

  if (!safeSignatureEqual(signedFileKey.signature, expectedSignature)) {
    throwInvalidFileKeySignature();
  }
}

function parseSignedFileKey(fileKey: string):
  | {
      expiresAt: number;
      signature: string;
      unsignedFileKey: string;
    }
  | undefined {
  const parts = fileKey.split("~");

  if (parts.length < 3) {
    return undefined;
  }

  const [signature, expiresAtText] = parts.slice(-2).reverse();
  const unsignedFileKey = parts.slice(0, -2).join("~");
  const expiresAt = Number(expiresAtText);

  if (!unsignedFileKey || !Number.isSafeInteger(expiresAt) || !signature) {
    return undefined;
  }

  return {
    expiresAt,
    signature,
    unsignedFileKey,
  };
}

function signFileKey(
  actorUserId: string,
  input: {
    expiresAt: number;
    fileKey: string;
    mimeType: string;
    size: number;
    targetId: string;
    targetType: AttachmentTargetType;
  },
): string {
  const payload = [
    actorUserId,
    input.targetType,
    input.targetId,
    input.fileKey,
    input.mimeType,
    input.size,
    input.expiresAt,
  ].join("\n");

  return createHmac("sha256", attachmentSigningSecret())
    .update(payload)
    .digest("base64url");
}

function attachmentSigningSecret(): string {
  return (
    process.env["ATTACHMENT_FILE_KEY_SECRET"] ??
    process.env["DATABASE_URL"] ??
    "local-attachment-signing-key"
  );
}

function safeSignatureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function throwInvalidFileKeySignature(): never {
  throw new ApiException(
    "VALIDATION_ERROR",
    "fileKey signature is invalid",
    HttpStatus.BAD_REQUEST,
  );
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[/\\]/gu, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return sanitized || "file";
}

function createObjectUrl(
  action: "download" | "upload",
  fileKey: string,
  expiresInSeconds: number,
  objectStorageOrigin: string,
): string {
  const url = new URL(
    `/${action}/${encodeURIComponent(fileKey)}`,
    objectStorageOrigin,
  );
  url.searchParams.set("expiresIn", String(expiresInSeconds));
  return url.toString();
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
