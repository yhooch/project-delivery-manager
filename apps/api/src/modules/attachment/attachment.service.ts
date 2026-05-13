import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  AttachmentDownloadUrlExpiresInSeconds,
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  AttachmentMimeTypeSchema,
  PresignedUploadUrlExpiresInSeconds,
  type Attachment,
  type CreateAttachmentRequest,
  type GetAttachmentDownloadUrlResponse,
  type PresignAttachmentRequest,
  type PresignAttachmentResponse,
  type Requirement,
  type SpaceRole,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import {
  REQUIREMENT_REPOSITORY,
  type RequirementRepository,
} from "../requirement/requirement.repository";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import {
  ATTACHMENT_REPOSITORY,
  type AttachmentRepository,
} from "./attachment.repository";
import type { AttachmentTargetContext } from "./attachment.types";

const REQUIREMENT_WRITER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);

const OBJECT_STORAGE_ORIGIN = "https://object-storage.local";

@Injectable()
export class AttachmentService {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY)
    private readonly attachments: AttachmentRepository,
    @Inject(REQUIREMENT_REPOSITORY)
    private readonly requirements: RequirementRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
  ) {}

  async presign(
    actorUserId: string,
    input: PresignAttachmentRequest,
  ): Promise<PresignAttachmentResponse> {
    this.assertFileConstraints(input);
    await this.requireWritableDraftRequirementTarget(actorUserId, input);
    await this.assertAttachmentCountLimit(input.targetType, input.targetId);

    const fileKey = createFileKey(input.targetType, input.targetId, input.fileName);

    return {
      uploadUrl: createObjectUrl("upload", fileKey, PresignedUploadUrlExpiresInSeconds),
      fileKey,
      expiresInSeconds: PresignedUploadUrlExpiresInSeconds,
    };
  }

  async create(
    actorUserId: string,
    input: CreateAttachmentRequest,
  ): Promise<Attachment> {
    this.assertFileConstraints(input);
    if (!isExpectedFileKey(input.targetType, input.targetId, input.fileKey)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "fileKey does not match attachment target",
        HttpStatus.BAD_REQUEST,
      );
    }

    const target = await this.requireWritableDraftRequirementTarget(
      actorUserId,
      input,
    );
    await this.assertAttachmentCountLimit(input.targetType, input.targetId);

    return this.attachments.create({
      id: ulid(),
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetType: input.targetType,
      targetId: input.targetId,
      fileName: input.fileName,
      fileKey: input.fileKey,
      mimeType: input.mimeType,
      size: input.size,
      uploadedById: actorUserId,
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

    const access = await this.spaces.findAccessibleById(
      actorUserId,
      attachment.spaceId,
    );

    if (!access) {
      throwAttachmentTargetNotFound();
    }

    return {
      downloadUrl: createObjectUrl(
        "download",
        attachment.fileKey,
        AttachmentDownloadUrlExpiresInSeconds,
      ),
      expiresInSeconds: AttachmentDownloadUrlExpiresInSeconds,
    };
  }

  private async requireWritableDraftRequirementTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: "REQUIREMENT" | "WORK_ITEM";
    },
  ): Promise<AttachmentTargetContext> {
    if (input.targetType !== "REQUIREMENT") {
      throwAttachmentTargetNotFound();
    }

    const requirement = await this.requireAccessibleRequirementTarget(
      actorUserId,
      input.targetId,
    );
    const access = await this.spaces.findAccessibleById(
      actorUserId,
      requirement.spaceId,
    );

    if (!access) {
      throwAttachmentTargetNotFound();
    }
    if (!REQUIREMENT_WRITER_ROLES.has(access.role)) {
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
      organizationId: requirement.organizationId,
      spaceId: requirement.spaceId,
      targetType: "REQUIREMENT",
      targetId: requirement.id,
    };
  }

  private async requireAccessibleRequirementTarget(
    actorUserId: string,
    requirementId: string,
  ): Promise<Requirement> {
    const requirement = await this.requirements.findById(requirementId);

    if (!requirement) {
      throwAttachmentTargetNotFound();
    }

    const access = await this.spaces.findAccessibleById(
      actorUserId,
      requirement.spaceId,
    );

    if (!access) {
      throwAttachmentTargetNotFound();
    }

    return requirement;
  }

  private async assertAttachmentCountLimit(
    targetType: "REQUIREMENT" | "WORK_ITEM",
    targetId: string,
  ) {
    const count = await this.attachments.countByTarget(targetType, targetId);

    if (count >= AttachmentMaxCountPerTarget) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Attachment count limit exceeded",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertFileConstraints(input: { mimeType: string; size: number }) {
    if (input.size <= 0 || input.size > AttachmentMaxSizeBytes) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Attachment size exceeds the allowed range",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!AttachmentMimeTypeSchema.safeParse(input.mimeType).success) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Attachment MIME type is not allowed",
        HttpStatus.BAD_REQUEST,
      );
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
  return fileKey.startsWith(`attachments/${targetType.toLowerCase()}/${targetId}/`);
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
): string {
  const url = new URL(`/${action}/${encodeURIComponent(fileKey)}`, OBJECT_STORAGE_ORIGIN);
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

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}
