import {
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
  type AttachmentRepository,
} from "./attachment.repository";
import { AttachmentService } from "./attachment.service";

describe("AttachmentService", () => {
  it("resolves writable WORK_ITEM targets without requiring DRAFT status", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const attachments = {
      countByTarget: vi.fn(async () => 0),
      create: vi.fn(async (input) => fakeAttachment(input.id, input.fileKey)),
      findById: vi.fn(),
      listByTarget: vi.fn(),
    } as unknown as AttachmentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        title: "Task",
        role: "TESTER" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const audit = createAuditService();
    const service = new AttachmentService(
      attachments,
      {} as RequirementRepository,
      targets,
      audit,
    );
    const presign = await service.presign(actorUserId, {
      targetType: "WORK_ITEM",
      targetId: workItemId,
      fileName: "spec.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });

    await service.create(
      actorUserId,
      {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey: presign.fileKey,
        mimeType: "application/pdf",
        size: 1024,
      },
      { requestId: "req-attachment" },
    );

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
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM",
        uploadedById: actorUserId,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: actorUserId,
        metadata: expect.objectContaining({
          fileName: "spec.pdf",
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

  it("does not create attachments when WORK_ITEM visibility resolution rejects", async () => {
    const actorUserId = ulid();
    const workItemId = ulid();
    const attachments = {
      countByTarget: vi.fn(async () => 0),
      create: vi.fn(),
      findById: vi.fn(),
      listByTarget: vi.fn(),
    } as unknown as AttachmentRepository;
    const targets = {
      resolve: vi.fn(),
    } as unknown as TargetResolverService;
    const audit = createAuditService();
    const service = new AttachmentService(
      attachments,
      {} as RequirementRepository,
      targets,
      audit,
    );
    vi.mocked(targets.resolve).mockResolvedValueOnce({
      organizationId: ulid(),
      spaceId: ulid(),
      targetId: workItemId,
      targetType: "WORK_ITEM",
      title: "Task",
      role: "PM",
      canWrite: true,
    });
    const presign = await service.presign(actorUserId, {
      targetType: "WORK_ITEM",
      targetId: workItemId,
      fileName: "spec.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });
    vi.mocked(targets.resolve).mockRejectedValueOnce(new Error("not visible"));

    await expect(
      service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey: presign.fileKey,
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toThrow("not visible");
    expect(attachments.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects forged and expired attachment registrations", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const attachments = {
      countByTarget: vi.fn(async () => 0),
      create: vi.fn(),
      findById: vi.fn(),
      listByTarget: vi.fn(),
    } as unknown as AttachmentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        title: "Task",
        role: "PM" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const service = new AttachmentService(
      attachments,
      {} as RequirementRepository,
      targets,
      createAuditService(),
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T00:00:00.000Z"));

    try {
      const presign = await service.presign(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        mimeType: "application/pdf",
        size: 1024,
      });

      await expect(
        service.create(actorUserId, {
          targetType: "WORK_ITEM",
          targetId: workItemId,
          fileName: "spec.pdf",
          fileKey: presign.fileKey,
          mimeType: "application/pdf",
          size: 2048,
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });

      vi.setSystemTime(
        new Date(Date.now() + PresignedUploadUrlExpiresInSeconds * 1000 + 1),
      );

      await expect(
        service.create(actorUserId, {
          targetType: "WORK_ITEM",
          targetId: workItemId,
          fileName: "spec.pdf",
          fileKey: presign.fileKey,
          mimeType: "application/pdf",
          size: 1024,
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    } finally {
      vi.useRealTimers();
    }
    expect(attachments.create).not.toHaveBeenCalled();
  });

  it("returns dedicated error codes for attachment size, MIME, and count limits", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const attachments = {
      countByTarget: vi.fn(async () => AttachmentMaxCountPerTarget),
      create: vi.fn(),
      findById: vi.fn(),
      listByTarget: vi.fn(),
    } as unknown as AttachmentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        title: "Task",
        role: "PM" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const service = new AttachmentService(
      attachments,
      {} as RequirementRepository,
      targets,
      createAuditService(),
    );

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
    expect(attachments.create).not.toHaveBeenCalled();
  });

  it("maps concurrent repository count-limit failures to the public error code", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const attachments = {
      countByTarget: vi.fn(async () => AttachmentMaxCountPerTarget - 1),
      create: vi.fn(async () => {
        throw new AttachmentLimitExceededError();
      }),
      findById: vi.fn(),
      listByTarget: vi.fn(),
    } as unknown as AttachmentRepository;
    const targets = {
      resolve: vi.fn(async () => ({
        organizationId,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM" as const,
        title: "Task",
        role: "PM" as const,
        canWrite: true,
      })),
    } as unknown as TargetResolverService;
    const service = new AttachmentService(
      attachments,
      {} as RequirementRepository,
      targets,
      createAuditService(),
    );
    const presign = await service.presign(actorUserId, {
      targetType: "WORK_ITEM",
      targetId: workItemId,
      fileName: "spec.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });

    await expect(
      service.create(actorUserId, {
        targetType: "WORK_ITEM",
        targetId: workItemId,
        fileName: "spec.pdf",
        fileKey: presign.fileKey,
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_LIMIT_EXCEEDED",
    });
  });
});

function fakeAttachment(id: string, fileKey: string): Attachment {
  return {
    id,
    organizationId: ulid(),
    spaceId: ulid(),
    targetType: "WORK_ITEM",
    targetId: ulid(),
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
