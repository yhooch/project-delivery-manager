import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  AttachmentDownloadUrlExpiresInSeconds,
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  AttachmentMimeTypeSchema,
  PresignedUploadUrlExpiresInSeconds,
  type Attachment,
  type AttachmentTargetType,
  type CreateAttachmentRequest,
  type GetAttachmentDownloadUrlResponse,
  type PageResult,
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
import { TargetResolverService } from "../target/target-resolver.service";
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
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
  ) {}

  async presign(
    actorUserId: string,
    input: PresignAttachmentRequest,
  ): Promise<PresignAttachmentResponse> {
    this.assertFileConstraints(input);
    await this.requireWritableAttachmentTarget(actorUserId, input);
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

    const target = await this.requireWritableAttachmentTarget(
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

    const access = await this.spaces.findAccessibleById(
      actorUserId,
      attachment.spaceId,
    );

    if (!access) {
      throwAttachmentTargetNotFound();
    }

    if (attachment.targetType === "WORK_ITEM") {
      await this.requireReadableWorkItemAttachmentTarget(actorUserId, {
        targetId: attachment.targetId,
        targetType: attachment.targetType,
      });
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
      targetType: "REQUIREMENT";
    },
  ): Promise<AttachmentTargetContext> {
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

    return this.requireWritableWorkItemAttachmentTarget(actorUserId, {
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
    if (input.targetType === "REQUIREMENT") {
      const requirement = await this.requireAccessibleRequirementTarget(
        actorUserId,
        input.targetId,
      );

      return {
        organizationId: requirement.organizationId,
        spaceId: requirement.spaceId,
        targetType: "REQUIREMENT",
        targetId: requirement.id,
      };
    }

    return this.requireReadableWorkItemAttachmentTarget(actorUserId, {
      targetId: input.targetId,
      targetType: "WORK_ITEM",
    });
  }

  private async requireReadableWorkItemAttachmentTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: "WORK_ITEM";
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
      targetType: "WORK_ITEM",
      targetId: target.targetId,
    };
  }

  private async requireWritableWorkItemAttachmentTarget(
    actorUserId: string,
    input: {
      targetId: string;
      targetType: "WORK_ITEM";
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
      targetType: "WORK_ITEM",
      targetId: target.targetId,
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
    targetType: AttachmentTargetType,
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
