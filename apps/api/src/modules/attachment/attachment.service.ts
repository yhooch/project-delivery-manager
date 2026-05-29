import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  AttachmentMimeTypeSchema,
  type Attachment,
  type AttachmentMimeType,
  type AttachmentTargetType,
  type PageResult,
  type RealtimeInvalidationKey,
  type SpaceRole,
  type UploadAttachmentRequest,
  type WorkItemType,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { auditAccessDenied } from "../audit/audit-access-denied";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import {
  REQUIREMENT_REPOSITORY,
  type RequirementRepository,
} from "../requirement/requirement.repository";
import {
  legacyRequirementRealtimeHints,
  withDocumentRequirementInvalidates,
} from "../target/legacy-target-normalizer";
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
  type AttachmentObjectStorage,
} from "./storage/attachment-object-storage";

const REQUIREMENT_WRITER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);

export type AttachmentUploadFile = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  size: number;
};

export type AttachmentDownload = {
  attachment: Attachment;
  body: Buffer;
  mimeType: string;
  size: number;
};

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

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
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
  ) {}

  async upload(
    actorUserId: string,
    input: UploadAttachmentRequest,
    file: AttachmentUploadFile,
    metadata: RequestMetadata = {},
  ): Promise<Attachment> {
    const parsedFile = this.assertFileConstraints(file);

    const target = await this.requireWritableAttachmentTarget(
      actorUserId,
      input,
      metadata,
    );
    await this.assertAttachmentCountLimit(target);

    const fileKey = createFileKey(
      target.targetType,
      target.targetId,
      file.fileName,
    );

    await this.objectStorage.putObject({
      body: file.buffer,
      key: fileKey,
      mimeType: parsedFile.mimeType,
      size: file.size,
    });

    const created = await this.createAttachmentAfterObjectUpload(fileKey, {
      id: ulid(),
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetType: target.targetType,
      targetId: target.targetId,
      targetWorkItemType: target.targetWorkItemType,
      fileName: file.fileName,
      fileKey,
      mimeType: parsedFile.mimeType,
      size: file.size,
      uploadedById: actorUserId,
    });

    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created,
      metadata: {
        fileName: file.fileName,
        mimeType: parsedFile.mimeType,
        size: file.size,
        targetId: input.targetId,
        targetType: input.targetType,
      },
      ...metadata,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetId: created.id,
      targetType: "ATTACHMENT",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      target: { type: target.targetType, id: target.targetId },
      operation: "ATTACHMENT_CHANGED",
      invalidates: attachmentInvalidates(
        target.targetType,
        target.targetWorkItemType,
        target.targetKind,
      ),
      hints: legacyRequirementRealtimeHints({
        targetType: target.targetType,
        targetId: target.targetId,
        targetKind: target.targetKind,
        spaceId: target.spaceId,
        workItemType: target.targetWorkItemType,
      }),
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
      organizationId: target.organizationId,
      page: input.page,
      pageSize: input.pageSize,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: target.targetType,
    });
  }

  async download(
    actorUserId: string,
    attachmentId: string,
  ): Promise<AttachmentDownload> {
    const attachmentContext =
      await this.attachments.findTargetContextById(attachmentId);

    if (!attachmentContext) {
      throwAttachmentTargetNotFound();
    }

    const target = await this.requireReadableAttachmentTarget(actorUserId, {
      targetId: attachmentContext.targetId,
      targetType: attachmentContext.targetType,
    });

    const attachment = await this.attachments.findById({
      attachmentId,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: target.targetType,
    });

    if (!attachment) {
      throwAttachmentTargetNotFound();
    }

    const object = await this.objectStorage.getObject({
      key: attachment.fileKey,
    });

    if (!object) {
      throwAttachmentTargetNotFound();
    }

    return {
      attachment,
      body: object.body,
      mimeType: object.mimeType,
      size: object.size,
    };
  }

  private async assertWritableDraftRequirementTarget(
    actorUserId: string,
    target: AttachmentTargetContext & { role: SpaceRole },
    metadata: RequestMetadata = {},
  ): Promise<void> {
    const requirement = await this.requirements.findById(target.targetId);

    if (!requirement) {
      throwAttachmentTargetNotFound();
    }
    if (!REQUIREMENT_WRITER_ROLES.has(target.role)) {
      await auditAccessDenied(this.audit, {
        ...metadata,
        actorId: actorUserId,
        metadata: { role: target.role },
        operation: "writeAttachment",
        organizationId: target.organizationId,
        reason: "ROLE_NOT_ALLOWED",
        spaceId: target.spaceId,
        targetId: target.targetId,
        targetType: "DOCUMENT",
      });
      throwSpaceAccessDenied();
    }
    if (requirement.status !== "DRAFT") {
      throw new ApiException(
        "DRAFT_REQUIREMENT_REQUIRED",
        "Only draft requirements can receive new attachments",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async requireWritableAttachmentTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: AttachmentTargetType;
    },
    metadata: RequestMetadata = {},
  ): Promise<AttachmentTargetContext> {
    if (input.targetType === "DOCUMENT") {
      return this.requireWritableResolvedAttachmentTarget(
        actorUserId,
        {
          targetId: input.targetId,
          targetType: "DOCUMENT",
        },
        metadata,
      );
    }

    return this.requireWritableResolvedAttachmentTarget(
      actorUserId,
      {
        targetId: input.targetId,
        targetType: "WORK_ITEM",
      },
      metadata,
    );
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
      targetKind:
        target.targetKind === "REQUIREMENT" ? "REQUIREMENT" : undefined,
      targetType: input.targetType,
      targetId: target.targetId,
      targetWorkItemType: target.workItemType,
    };
  }

  private async requireWritableResolvedAttachmentTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: AttachmentTargetType;
    },
    metadata: RequestMetadata = {},
  ): Promise<AttachmentTargetContext> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
      {
        access: "write",
        audit: {
          ...metadata,
          operation: "writeAttachment",
        },
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      },
    );

    const resolvedTarget: AttachmentTargetContext = {
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetKind:
        target.targetKind === "REQUIREMENT" ? "REQUIREMENT" : undefined,
      targetType: input.targetType,
      targetId: target.targetId,
      targetWorkItemType: target.workItemType,
    };

    if (resolvedTarget.targetKind === "REQUIREMENT") {
      await this.assertWritableDraftRequirementTarget(
        actorUserId,
        {
          ...resolvedTarget,
          role: target.role,
        },
        metadata,
      );
    }

    return resolvedTarget;
  }

  private async assertAttachmentCountLimit(target: AttachmentTargetContext) {
    const count = await this.attachments.countByTarget(target);

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

  private async createAttachmentAfterObjectUpload(
    fileKey: string,
    input: Parameters<AttachmentRepository["create"]>[0],
  ): Promise<Attachment> {
    try {
      return await this.createAttachmentOrThrowPublicError(input);
    } catch (error) {
      return await this.deleteUploadedObjectAfterCreateFailure(fileKey, error);
    }
  }

  private async deleteUploadedObjectAfterCreateFailure(
    fileKey: string,
    error: unknown,
  ): Promise<never> {
    try {
      await this.objectStorage.deleteObjectIfExists(fileKey);
    } catch (deleteError) {
      this.logger.warn(
        `Failed to delete unregistered attachment object ${fileKey}: ${
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError)
        }`,
      );
    }

    throw error;
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

  private safePublishRealtime(
    input: Parameters<RealtimePublisherService["publish"]>[0],
  ) {
    try {
      this.realtime.publish(input);
    } catch (error) {
      this.logger.error(
        "Failed to publish attachment realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function attachmentInvalidates(
  targetType: AttachmentTargetType,
  workItemType: WorkItemType | undefined,
  targetKind?: "REQUIREMENT",
): RealtimeInvalidationKey[] {
  switch (targetType) {
    case "DOCUMENT":
      if (targetKind === "REQUIREMENT") {
        return withDocumentRequirementInvalidates(
          targetType,
          [
            "attachments",
            "timeline",
            "document-attachments",
            "document-timeline",
            "document-detail",
          ],
          ["requirement-detail"],
          targetKind,
        );
      }

      return withDocumentRequirementInvalidates(
        targetType,
        [
          "attachments",
          "timeline",
          "document-attachments",
          "document-timeline",
          "document-detail",
        ],
        ["requirement-detail"],
        targetKind,
      );
    case "WORK_ITEM":
      return [
        "attachments",
        "timeline",
        workItemType === "BUG" ? "bug-list" : "work-item-list",
        "version-board",
        "workbench",
        "space-overview",
      ];
  }
}

function createFileKey(
  targetType: AttachmentTargetType,
  targetId: string,
  fileName: string,
): string {
  return `attachments/${targetType.toLowerCase()}/${targetId}/${ulid()}-${sanitizeFileName(fileName)}`;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[/\\]/gu, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return sanitized || "file";
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
