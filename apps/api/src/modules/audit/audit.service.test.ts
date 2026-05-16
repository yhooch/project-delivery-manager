import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "./audit.service";

describe("AuditService", () => {
  it("includes requestId when audit writes fail", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const prisma = {
      client: {
        auditLog: {
          create: vi.fn(async () => {
            throw new Error("database unavailable");
          }),
        },
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.record({
      actionType: "UPDATE",
      organizationId: "01H00000000000000000000001",
      requestId: "req-audit-failure",
      targetId: "01H00000000000000000000002",
      targetType: "USER",
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("requestId=req-audit-failure"),
    );
    warn.mockRestore();
  });
});
