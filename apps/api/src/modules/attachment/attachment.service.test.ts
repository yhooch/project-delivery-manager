import { Logger } from "@nestjs/common";
import {
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  type Attachment,
} from "@project-delivery/shared";
import { ulid } from "ulid";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { RequirementRepository } from "../requirement/requirement.repository";
import type { TargetResolverService } from "../target/target-resolver.service";
import {
  AttachmentLimitExceededError,
  AttachmentTargetNotFoundError,
  type AttachmentRepository,
} from "./attachment.repository";
import {
  AttachmentService,
  type AttachmentUploadFile,
} from "./attachment.service";
import type { CreateAttachmentInput } from "./attachment.types";
import type { AttachmentObjectStorage } from "./storage/attachment-object-storage";

describe("AttachmentService", () => {
  it("uploads files through the object storage adapter and registers the attachment", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const { service, attachments, audit, objectStorage, realtime, targets } =
      createServiceFixture({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetWorkItemType: "BUG",
      });

    const created = await service.upload(
      actorUserId,
      {
        targetType: "WORK_ITEM",
        targetId: workItemId,
      },
      uploadFile({
        fileName: "spec.pdf",
        mimeType: "application/pdf",
        size: 1024,
      }),
      { requestId: "req-attachment" },
    );

    expect(created.fileKey).toMatch(
      new RegExp(
        `^attachments/work_item/${workItemId}/[0-9A-HJKMNP-TV-Z]{26}-spec\\.pdf$`,
      ),
    );
    expect(targets.resolve).toHaveBeenCalledWith(
      actorUserId,
      "WORK_ITEM",
      workItemId,
      expect.objectContaining({
        access: "write",
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      }),
    );
    expect(attachments.countByTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM",
      }),
    );
    expect(objectStorage.putObject).toHaveBeenCalledWith({
      body: expect.any(Buffer),
      key: created.fileKey,
      mimeType: "application/pdf",
      size: 1024,
    });
    expect(attachments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fileKey: created.fileKey,
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM",
        targetWorkItemType: "BUG",
        uploadedById: actorUserId,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: actorUserId,
        metadata: expect.objectContaining({
          fileName: "spec.pdf",
          mimeType: "application/pdf",
          size: 1024,
          targetId: workItemId,
          targetType: "WORK_ITEM",
        }),
        organizationId,
        requestId: "req-attachment",
        spaceId,
        targetType: "ATTACHMENT",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "ATTACHMENT_CHANGED",
        target: { type: "WORK_ITEM", id: workItemId },
        invalidates: expect.arrayContaining(["attachments", "timeline"]),
        hints: expect.objectContaining({
          targetId: workItemId,
          targetType: "WORK_ITEM",
          workItemType: "BUG",
        }),
      }),
    );
  });

  it("downloads files after resolving current read permission", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const attachment = fakeAttachment(
      ulid(),
      validFileKey("WORK_ITEM", workItemId),
      workItemId,
      {
        organizationId,
        spaceId,
      },
    );
    const { service, attachments, objectStorage, targets } =
      createServiceFixture({
        attachment,
        organizationId,
        spaceId,
        targetId: workItemId,
      });

    const download = await service.download(actorUserId, attachment.id);

    expect(targets.resolve).toHaveBeenCalledWith(
      actorUserId,
      "WORK_ITEM",
      workItemId,
      {
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      },
    );
    expect(attachments.findTargetContextById).toHaveBeenCalledWith(
      attachment.id,
    );
    expect(attachments.findById).toHaveBeenCalledWith({
      attachmentId: attachment.id,
      organizationId,
      spaceId,
      targetId: workItemId,
      targetType: "WORK_ITEM",
    });
    expect(objectStorage.getObject).toHaveBeenCalledWith({
      key: attachment.fileKey,
    });
    expect(download).toEqual({
      attachment,
      body: Buffer.from("stored-file"),
      mimeType: "application/pdf",
      size: 11,
    });
  });

  it("publishes requirement document hints for requirement attachments", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const requirementId = ulid();
    const { service, attachments, realtime, targets } = createServiceFixture({
      organizationId,
      spaceId,
      targetId: requirementId,
    });
    vi.mocked(targets.resolve).mockResolvedValueOnce({
      organizationId,
      spaceId,
      targetId: requirementId,
      targetKind: "REQUIREMENT",
      targetType: "DOCUMENT",
      role: "PM",
      canWrite: true,
    });

    await service.upload(
      actorUserId,
      {
        targetType: "DOCUMENT",
        targetId: requirementId,
      },
      uploadFile(),
    );

    expect(attachments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: requirementId,
        targetType: "DOCUMENT",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: "DOCUMENT", id: requirementId },
        invalidates: expect.arrayContaining([
          "requirement-detail",
          "document-attachments",
          "document-timeline",
          "document-detail",
        ]),
        hints: expect.objectContaining({
          canonicalTargetType: "DOCUMENT",
          requirementId,
          targetId: requirementId,
          targetKind: "REQUIREMENT",
          targetType: "DOCUMENT",
        }),
      }),
    );
  });

  it("does not download files when the attachment row does not match the resolved target context", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const attachment = fakeAttachment(
      ulid(),
      validFileKey("WORK_ITEM", workItemId),
      workItemId,
      {
        organizationId: ulid(),
        spaceId: ulid(),
      },
    );
    const { service, attachments, objectStorage } = createServiceFixture({
      attachment,
      organizationId,
      spaceId,
      targetId: workItemId,
    });
    vi.mocked(attachments.findById).mockResolvedValueOnce(undefined);

    await expect(
      service.download(actorUserId, attachment.id),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_TARGET_NOT_FOUND",
    });
    expect(objectStorage.getObject).not.toHaveBeenCalled();
  });

  it("does not upload files when WORK_ITEM visibility resolution rejects", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const { service, attachments, audit, objectStorage, targets } =
      createServiceFixture({
        targetId: workItemId,
      });
    vi.mocked(targets.resolve).mockRejectedValueOnce(new Error("not visible"));

    await expect(
      service.upload(
        actorUserId,
        {
          targetType: "WORK_ITEM",
          targetId: workItemId,
        },
        uploadFile(),
      ),
    ).rejects.toThrow("not visible");
    expect(objectStorage.putObject).not.toHaveBeenCalled();
    expect(attachments.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns dedicated error codes for attachment size, MIME, and count limits", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const { service, attachments, objectStorage } = createServiceFixture({
      countByTarget: AttachmentMaxCountPerTarget,
      targetId: workItemId,
    });

    await expect(
      service.upload(
        actorUserId,
        {
          targetType: "WORK_ITEM",
          targetId: workItemId,
        },
        uploadFile({ fileName: "large.pdf", size: AttachmentMaxSizeBytes + 1 }),
      ),
    ).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    await expect(
      service.upload(
        actorUserId,
        {
          targetType: "WORK_ITEM",
          targetId: workItemId,
        },
        uploadFile({
          fileName: "payload.bin",
          mimeType: "application/octet-stream",
        }),
      ),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MIME_TYPE",
    });
    await expect(
      service.upload(
        actorUserId,
        {
          targetType: "WORK_ITEM",
          targetId: workItemId,
        },
        uploadFile({ fileName: "fractional.pdf", size: 1024.5 }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      service.upload(
        actorUserId,
        {
          targetType: "WORK_ITEM",
          targetId: workItemId,
        },
        uploadFile(),
      ),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_LIMIT_EXCEEDED",
    });
    expect(objectStorage.putObject).not.toHaveBeenCalled();
    expect(attachments.create).not.toHaveBeenCalled();
  });

  it("deletes uploaded objects when repository creation fails", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const limitFixture = createServiceFixture({
      createError: new AttachmentLimitExceededError(),
      targetId: workItemId,
    });

    await expect(
      limitFixture.service.upload(
        actorUserId,
        {
          targetType: "WORK_ITEM",
          targetId: workItemId,
        },
        uploadFile(),
      ),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_LIMIT_EXCEEDED",
    });
    expect(
      limitFixture.objectStorage.deleteObjectIfExists,
    ).toHaveBeenCalledWith(
      expect.stringMatching(`^attachments/work_item/${workItemId}/`),
    );

    const targetFixture = createServiceFixture({
      createError: new AttachmentTargetNotFoundError(),
      targetId: workItemId,
    });

    await expect(
      targetFixture.service.upload(
        actorUserId,
        {
          targetType: "WORK_ITEM",
          targetId: workItemId,
        },
        uploadFile(),
      ),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_TARGET_NOT_FOUND",
    });
    expect(targetFixture.audit.record).not.toHaveBeenCalled();
  });

  it("keeps the original create error when best-effort object deletion fails", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const logger = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const objectStorage = createObjectStorage({
      deleteObjectIfExists: vi.fn(async () => {
        throw new Error("delete failed");
      }),
    });
    const { service } = createServiceFixture({
      createError: new AttachmentLimitExceededError(),
      objectStorage,
      targetId: workItemId,
    });

    await expect(
      service.upload(
        actorUserId,
        {
          targetType: "WORK_ITEM",
          targetId: workItemId,
        },
        uploadFile(),
      ),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_LIMIT_EXCEEDED",
    });
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to delete unregistered attachment object",
      ),
    );
    logger.mockRestore();
  });
});

function createServiceFixture(
  options: {
    attachment?: Attachment;
    countByTarget?: number;
    createError?: Error;
    objectStorage?: MockAttachmentObjectStorage;
    organizationId?: string;
    spaceId?: string;
    targetId?: string;
    targetWorkItemType?: "BUG" | "TASK";
  } = {},
) {
  const organizationId = options.organizationId ?? ulid();
  const spaceId = options.spaceId ?? ulid();
  const targetId = options.targetId ?? ulid();
  const attachments = {
    countByTarget: vi.fn(async () => options.countByTarget ?? 0),
    create: vi.fn(async (input: CreateAttachmentInput) => {
      if (options.createError) {
        throw options.createError;
      }

      return fakeAttachment(input.id, input.fileKey, input.targetId, {
        fileName: input.fileName,
        mimeType: input.mimeType,
        organizationId: input.organizationId,
        size: input.size,
        spaceId: input.spaceId,
        targetType: input.targetType,
        uploadedById: input.uploadedById,
      });
    }),
    findById: vi.fn(async () => options.attachment),
    findTargetContextById: vi.fn(async () =>
      options.attachment
        ? {
            organizationId: options.attachment.organizationId,
            spaceId: options.attachment.spaceId,
            targetId: options.attachment.targetId,
            targetType: options.attachment.targetType,
          }
        : undefined,
    ),
    listByTarget: vi.fn(
      async (input: Parameters<AttachmentRepository["listByTarget"]>[0]) => ({
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      }),
    ),
  } as unknown as AttachmentRepository & {
    countByTarget: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findTargetContextById: ReturnType<typeof vi.fn>;
    listByTarget: ReturnType<typeof vi.fn>;
  };
  const targets = {
    resolve: vi.fn(async () => ({
      organizationId,
      spaceId,
      targetId,
      targetType: "WORK_ITEM" as const,
      title: "Task",
      role: "PM" as const,
      canWrite: true,
      workItemType: options.targetWorkItemType,
    })),
  } as unknown as TargetResolverService & {
    resolve: ReturnType<typeof vi.fn>;
  };
  const audit = createAuditService();
  const objectStorage = options.objectStorage ?? createObjectStorage();
  const realtime = createRealtimePublisher();
  const service = new AttachmentService(
    attachments,
    {
      findById: vi.fn(async () => ({
        id: targetId,
        organizationId,
        spaceId,
        status: "DRAFT",
      })),
    } as unknown as RequirementRepository,
    targets,
    audit,
    objectStorage,
    realtime,
  );

  return {
    attachments,
    audit,
    objectStorage,
    realtime,
    service,
    targets,
  };
}

function createObjectStorage(
  overrides: Partial<MockAttachmentObjectStorage> = {},
): MockAttachmentObjectStorage {
  return {
    deleteObjectIfExists: vi.fn(async () => undefined),
    getObject: vi.fn(async () => ({
      body: Buffer.from("stored-file"),
      mimeType: "application/pdf",
      size: 11,
    })),
    putObject: vi.fn(async () => undefined),
    ...overrides,
  } as MockAttachmentObjectStorage;
}

type MockAttachmentObjectStorage = AttachmentObjectStorage & {
  deleteObjectIfExists: ReturnType<typeof vi.fn>;
  getObject: ReturnType<typeof vi.fn>;
  putObject: ReturnType<typeof vi.fn>;
};

function uploadFile(overrides: Partial<AttachmentUploadFile> = {}) {
  const size = overrides.size ?? 1024;

  return {
    buffer: overrides.buffer ?? Buffer.alloc(Math.max(Math.floor(size), 0)),
    fileName: overrides.fileName ?? "spec.pdf",
    mimeType: overrides.mimeType ?? "application/pdf",
    size,
  };
}

function validFileKey(
  targetType: "DOCUMENT" | "WORK_ITEM",
  targetId: string,
): string {
  return `attachments/${targetType.toLowerCase()}/${targetId}/${ulid()}-spec.pdf`;
}

function fakeAttachment(
  id: string,
  fileKey: string,
  targetId = ulid(),
  overrides: Partial<Attachment> = {},
): Attachment {
  return {
    id,
    organizationId: overrides.organizationId ?? ulid(),
    spaceId: overrides.spaceId ?? ulid(),
    targetType: overrides.targetType ?? "WORK_ITEM",
    targetId,
    fileName: "spec.pdf",
    fileKey,
    mimeType: "application/pdf",
    size: 1024,
    uploadedById: overrides.uploadedById ?? ulid(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createAuditService() {
  return {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
  };
}

function createRealtimePublisher() {
  return {
    publish: vi.fn(),
  } as unknown as RealtimePublisherService & {
    publish: ReturnType<typeof vi.fn>;
  };
}
