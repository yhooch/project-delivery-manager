import {
  AttachmentDownloadUrlExpiresInSeconds,
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  PresignedUploadUrlExpiresInSeconds,
  type Attachment,
} from "@project-delivery/shared";
import { ulid } from "ulid";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
import type { RequirementRepository } from "../requirement/requirement.repository";
import type { TargetResolverService } from "../target/target-resolver.service";
import {
  AttachmentLimitExceededError,
  AttachmentTargetNotFoundError,
  type AttachmentRepository,
} from "./attachment.repository";
import { AttachmentService } from "./attachment.service";
import type { CreateAttachmentInput } from "./attachment.types";
import type { AttachmentObjectStorage } from "./storage/attachment-object-storage";

describe("AttachmentService", () => {
  it("uses the object storage adapter to presign uploads with plain object keys", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const { service, attachments, objectStorage, targets } =
      createServiceFixture({
        targetId: workItemId,
      });

    const presign = await service.presign(actorUserId, {
      targetType: "WORK_ITEM",
      targetId: workItemId,
      fileName: "spec.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });

    expect(presign).toEqual({
      uploadUrl: "https://minio.example.test/upload",
      fileKey: expect.stringMatching(
        new RegExp(
          `^attachments/work_item/${workItemId}/[0-9A-HJKMNP-TV-Z]{26}-spec\\.pdf$`,
        ),
      ),
      expiresInSeconds: PresignedUploadUrlExpiresInSeconds,
    });
    expect(presign.fileKey).not.toContain("~");
    expect(targets.resolve).toHaveBeenCalledWith(
      actorUserId,
      "WORK_ITEM",
      workItemId,
      {
        access: "write",
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      },
    );
    expect(attachments.countByTarget).toHaveBeenCalledWith(
      "WORK_ITEM",
      workItemId,
    );
    expect(objectStorage.createPresignedUploadUrl).toHaveBeenCalledWith({
      expiresInSeconds: PresignedUploadUrlExpiresInSeconds,
      key: presign.fileKey,
      mimeType: "application/pdf",
    });
  });

  it("registers uploaded WORK_ITEM attachments after object metadata matches", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const fileKey = validFileKey("WORK_ITEM", workItemId);
    const { service, attachments, audit, objectStorage, targets } =
      createServiceFixture({
        organizationId,
        spaceId,
        targetId: workItemId,
      });

    const created = await service.create(
      actorUserId,
      {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey,
        mimeType: "application/pdf",
        size: 1024,
      },
      { requestId: "req-attachment" },
    );

    expect(objectStorage.statObject).toHaveBeenCalledWith(fileKey);
    expect(objectStorage.deleteObjectIfExists).not.toHaveBeenCalled();
    expect(targets.resolve).toHaveBeenCalledWith(
      actorUserId,
      "WORK_ITEM",
      workItemId,
      {
        access: "write",
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      },
    );
    expect(attachments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fileKey,
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM",
        uploadedById: actorUserId,
      }),
    );
    expect(created.fileKey).toBe(fileKey);
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
  });

  it("does not register attachments when the uploaded object is missing", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const fileKey = validFileKey("WORK_ITEM", workItemId);
    const objectStorage = createObjectStorage({
      statObject: vi.fn(async () => undefined),
    });
    const { service, attachments, audit } = createServiceFixture({
      objectStorage,
      targetId: workItemId,
    });

    await expect(
      service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey,
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Uploaded attachment object does not exist",
    });
    expect(attachments.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(objectStorage.deleteObjectIfExists).not.toHaveBeenCalled();
  });

  it("rejects uploaded objects whose size does not match registration", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const fileKey = validFileKey("WORK_ITEM", workItemId);
    const objectStorage = createObjectStorage({
      statObject: vi.fn(async () => ({
        mimeType: "application/pdf",
        size: 2048,
      })),
    });
    const { service, attachments } = createServiceFixture({
      objectStorage,
      targetId: workItemId,
    });

    await expect(
      service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey,
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        actualSize: 2048,
        expectedSize: 1024,
      },
      message: "Uploaded attachment size does not match registration",
    });
    expect(objectStorage.deleteObjectIfExists).toHaveBeenCalledWith(fileKey);
    expect(attachments.create).not.toHaveBeenCalled();
  });

  it("rejects uploaded objects whose MIME type does not match registration", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const fileKey = validFileKey("WORK_ITEM", workItemId);
    const objectStorage = createObjectStorage({
      statObject: vi.fn(async () => ({
        mimeType: "text/plain",
        size: 1024,
      })),
    });
    const { service, attachments } = createServiceFixture({
      objectStorage,
      targetId: workItemId,
    });

    await expect(
      service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey,
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        actualMimeType: "text/plain",
        expectedMimeType: "application/pdf",
      },
      message: "Uploaded attachment MIME type does not match registration",
    });
    expect(objectStorage.deleteObjectIfExists).toHaveBeenCalledWith(fileKey);
    expect(attachments.create).not.toHaveBeenCalled();
  });

  it("signs download URLs after resolving current read permission", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const attachment = fakeAttachment(
      ulid(),
      validFileKey("WORK_ITEM", workItemId),
      workItemId,
    );
    const { service, objectStorage, targets } = createServiceFixture({
      attachment,
      targetId: workItemId,
    });

    const download = await service.getDownloadUrl(actorUserId, attachment.id);

    expect(targets.resolve).toHaveBeenCalledWith(
      actorUserId,
      "WORK_ITEM",
      workItemId,
      {
        hideInaccessible: true,
        notFoundCode: "ATTACHMENT_TARGET_NOT_FOUND",
      },
    );
    expect(objectStorage.createPresignedDownloadUrl).toHaveBeenCalledWith({
      expiresInSeconds: AttachmentDownloadUrlExpiresInSeconds,
      key: attachment.fileKey,
    });
    expect(download).toEqual({
      downloadUrl: "https://minio.example.test/download",
      expiresInSeconds: AttachmentDownloadUrlExpiresInSeconds,
    });
  });

  it("does not create attachments when WORK_ITEM visibility resolution rejects", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const fileKey = validFileKey("WORK_ITEM", workItemId);
    const { service, attachments, audit, objectStorage, targets } =
      createServiceFixture({
        targetId: workItemId,
      });
    vi.mocked(targets.resolve).mockRejectedValueOnce(new Error("not visible"));

    await expect(
      service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey,
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toThrow("not visible");
    expect(objectStorage.statObject).not.toHaveBeenCalled();
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
      service.presign(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "large.pdf",
        mimeType: "application/pdf",
        size: AttachmentMaxSizeBytes + 1,
      }),
    ).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    await expect(
      service.presign(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "payload.bin",
        mimeType: "application/octet-stream",
        size: 1024,
      } as unknown as Parameters<AttachmentService["presign"]>[1]),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MIME_TYPE",
    });
    await expect(
      service.presign(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "fractional.pdf",
        mimeType: "application/pdf",
        size: 1024.5,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      service.presign(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_LIMIT_EXCEEDED",
    });
    expect(objectStorage.createPresignedUploadUrl).not.toHaveBeenCalled();
    expect(attachments.create).not.toHaveBeenCalled();
  });

  it("maps concurrent repository failures to public attachment error codes", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const fileKey = validFileKey("WORK_ITEM", workItemId);
    const limitFixture = createServiceFixture({
      createError: new AttachmentLimitExceededError(),
      targetId: workItemId,
    });

    await expect(
      limitFixture.service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey,
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_LIMIT_EXCEEDED",
    });

    const targetFixture = createServiceFixture({
      createError: new AttachmentTargetNotFoundError(),
      targetId: workItemId,
    });

    await expect(
      targetFixture.service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey,
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_TARGET_NOT_FOUND",
    });
    expect(targetFixture.audit.record).not.toHaveBeenCalled();
  });
});

function createServiceFixture(options: {
  attachment?: Attachment;
  countByTarget?: number;
  createError?: Error;
  objectStorage?: MockAttachmentObjectStorage;
  organizationId?: string;
  spaceId?: string;
  targetId?: string;
} = {}) {
  const organizationId = options.organizationId ?? ulid();
  const spaceId = options.spaceId ?? ulid();
  const targetId = options.targetId ?? ulid();
  const attachments = {
    countByTarget: vi.fn(async () => options.countByTarget ?? 0),
    create: vi.fn(async (input: CreateAttachmentInput) => {
      if (options.createError) {
        throw options.createError;
      }

      return fakeAttachment(input.id, input.fileKey, input.targetId);
    }),
    findById: vi.fn(async () => options.attachment),
    listByTarget: vi.fn(),
  } as unknown as AttachmentRepository & {
    countByTarget: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
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
    })),
  } as unknown as TargetResolverService & {
    resolve: ReturnType<typeof vi.fn>;
  };
  const audit = createAuditService();
  const objectStorage = options.objectStorage ?? createObjectStorage();
  const service = new AttachmentService(
    attachments,
    {} as RequirementRepository,
    targets,
    audit,
    objectStorage,
  );

  return {
    attachments,
    audit,
    objectStorage,
    service,
    targets,
  };
}

function createObjectStorage(
  overrides: Partial<MockAttachmentObjectStorage> = {},
): MockAttachmentObjectStorage {
  return {
    createPresignedDownloadUrl: vi.fn(
      async () => "https://minio.example.test/download",
    ),
    createPresignedUploadUrl: vi.fn(
      async () => "https://minio.example.test/upload",
    ),
    deleteObjectIfExists: vi.fn(async () => undefined),
    statObject: vi.fn(async () => ({
      mimeType: "application/pdf; charset=utf-8",
      size: 1024,
    })),
    ...overrides,
  } as MockAttachmentObjectStorage;
}

type MockAttachmentObjectStorage = AttachmentObjectStorage & {
  createPresignedDownloadUrl: ReturnType<typeof vi.fn>;
  createPresignedUploadUrl: ReturnType<typeof vi.fn>;
  deleteObjectIfExists: ReturnType<typeof vi.fn>;
  statObject: ReturnType<typeof vi.fn>;
};

function validFileKey(
  targetType: "REQUIREMENT" | "WORK_ITEM",
  targetId: string,
): string {
  return `attachments/${targetType.toLowerCase()}/${targetId}/${ulid()}-spec.pdf`;
}

function fakeAttachment(
  id: string,
  fileKey: string,
  targetId = ulid(),
): Attachment {
  return {
    id,
    organizationId: ulid(),
    spaceId: ulid(),
    targetType: "WORK_ITEM",
    targetId,
    fileName: "spec.pdf",
    fileKey,
    mimeType: "application/pdf",
    size: 1024,
    uploadedById: ulid(),
    createdAt: new Date().toISOString(),
  };
}

function createAuditService() {
  return {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
  };
}
