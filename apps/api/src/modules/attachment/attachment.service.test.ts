import type { Attachment } from "@project-delivery/shared";
import { ulid } from "ulid";
import { describe, expect, it, vi } from "vitest";

import type { RequirementRepository } from "../requirement/requirement.repository";
import type { SpaceRepository } from "../space/space.repository";
import type { TargetResolverService } from "../target/target-resolver.service";
import type { AttachmentRepository } from "./attachment.repository";
import { AttachmentService } from "./attachment.service";

describe("AttachmentService", () => {
  it("resolves writable WORK_ITEM targets without requiring DRAFT status", async () => {
    const actorUserId = ulid();
    const organizationId = ulid();
    const spaceId = ulid();
    const workItemId = ulid();
    const fileKey = `attachments/work_item/${workItemId}/${ulid()}-spec.pdf`;
    const attachments = {
      countByTarget: vi.fn(async () => 0),
      create: vi.fn(async (input) => fakeAttachment(input.id, fileKey)),
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
    const service = new AttachmentService(
      attachments,
      {} as RequirementRepository,
      {} as SpaceRepository,
      targets,
    );

    await service.create(actorUserId, {
      targetType: "WORK_ITEM",
      targetId: workItemId,
      fileName: "spec.pdf",
      fileKey,
      mimeType: "application/pdf",
      size: 1024,
    });

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
