import { AttachmentMaxCountPerTarget } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import {
  AttachmentLimitExceededError,
  AttachmentTargetNotFoundError,
  type AttachmentRepository,
} from "./attachment.repository";
import { PrismaAttachmentRepository } from "./prisma-attachment.repository";

describe("PrismaAttachmentRepository", () => {
  it("uses tenant target scope for count, list, and find read queries", async () => {
    const input = createAttachmentInput({ targetWorkItemType: "BUG" });
    const record = {
      ...input,
      createdAt: new Date("2026-05-15T00:00:00.000Z"),
    };
    const attachment = {
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => record),
      findMany: vi.fn(async () => [record]),
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (operations: Array<Promise<unknown>>) =>
          Promise.all(operations),
        ),
        attachment,
      },
    } as unknown as PrismaService;
    const repository = new PrismaAttachmentRepository(prisma);
    const target = {
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: input.targetType,
    };

    await repository.countByTarget(target);
    await repository.findById({
      ...target,
      attachmentId: input.id,
    });
    await repository.listByTarget({
      ...target,
      page: 2,
      pageSize: 10,
    });

    expect(attachment.count).toHaveBeenNthCalledWith(1, {
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
    expect(attachment.findFirst).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        id: input.id,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
    expect(attachment.findMany).toHaveBeenCalledWith({
      orderBy: {
        createdAt: "asc",
      },
      skip: 10,
      take: 10,
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
    expect(attachment.count).toHaveBeenNthCalledWith(2, {
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
  });

  it("locks the target and enforces the per-target count inside attachment create transaction", async () => {
    const input = createAttachmentInput({ targetWorkItemType: "BUG" });
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: input.targetId }]),
      attachment: {
        count: vi.fn(async () => AttachmentMaxCountPerTarget - 1),
        create: vi.fn(async () => ({
          ...input,
          createdAt: new Date("2026-05-15T00:00:00.000Z"),
        })),
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    } as unknown as PrismaService;
    const repository = new PrismaAttachmentRepository(prisma);

    await expect(repository.create(input)).resolves.toMatchObject({
      id: input.id,
      targetId: input.targetId,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.attachment.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
    expect(tx.attachment.create).toHaveBeenCalledTimes(1);
    expect(tx.timelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            fileName: input.fileName,
            targetWorkItemType: "BUG",
          }),
        }),
      }),
    );
  });

  it("rejects creation when the locked transaction sees the target already at the attachment limit", async () => {
    const input = createAttachmentInput();
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: input.targetId }]),
      attachment: {
        count: vi.fn(async () => AttachmentMaxCountPerTarget),
        create: vi.fn(),
      },
      timelineEvent: {
        create: vi.fn(),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    } as unknown as PrismaService;
    const repository = new PrismaAttachmentRepository(prisma);

    await expect(repository.create(input)).rejects.toBeInstanceOf(
      AttachmentLimitExceededError,
    );
    expect(tx.attachment.create).not.toHaveBeenCalled();
    expect(tx.timelineEvent.create).not.toHaveBeenCalled();
  });

  it.each(["WORK_ITEM", "DOCUMENT"] as const)(
    "rejects creation when the locked transaction finds no live %s target",
    async (targetType) => {
      const input = createAttachmentInput({ targetType });
      const tx = {
        $queryRaw: vi.fn(async () => []),
        attachment: {
          count: vi.fn(),
          create: vi.fn(),
        },
        timelineEvent: {
          create: vi.fn(),
        },
      };
      const prisma = {
        client: {
          $transaction: vi.fn(
            async (callback: (client: typeof tx) => unknown) => callback(tx),
          ),
        },
      } as unknown as PrismaService;
      const repository = new PrismaAttachmentRepository(prisma);

      await expect(repository.create(input)).rejects.toBeInstanceOf(
        AttachmentTargetNotFoundError,
      );
      expect(tx.attachment.count).not.toHaveBeenCalled();
      expect(tx.attachment.create).not.toHaveBeenCalled();
      expect(tx.timelineEvent.create).not.toHaveBeenCalled();
    },
  );
});

function createAttachmentInput(
  overrides: Partial<Parameters<AttachmentRepository["create"]>[0]> = {},
): Parameters<AttachmentRepository["create"]>[0] {
  return {
    id: "01H00000000000000000000000",
    organizationId: "01H00000000000000000000001",
    spaceId: "01H00000000000000000000002",
    targetType: "WORK_ITEM",
    targetId: "01H00000000000000000000003",
    fileName: "spec.pdf",
    fileKey: "attachments/spec.pdf",
    mimeType: "application/pdf",
    size: 1024,
    uploadedById: "01H00000000000000000000004",
    ...overrides,
  };
}
