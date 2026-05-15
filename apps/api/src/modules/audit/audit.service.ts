import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AuditAction } from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { RequestMetadata } from "../auth/auth-session.types";

type AuditInput = {
  actionType: AuditAction;
  actorId?: string;
  after?: unknown;
  before?: unknown;
  metadata?: unknown;
  organizationId: string;
  spaceId?: string;
  targetId: string;
  targetType: string;
} & RequestMetadata;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          id: ulid(),
          actionType: input.actionType,
          actorId: input.actorId,
          after: toJson(input.after),
          before: toJson(input.before),
          ip: input.ip,
          metadata: toJson(input.metadata),
          organizationId: input.organizationId,
          requestId: input.requestId,
          spaceId: input.spaceId,
          targetId: input.targetId,
          targetType: input.targetType,
          userAgent: input.userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Audit write failed for ${input.actionType} ${input.targetType}:${input.targetId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async recordForUserOrganizations(
    userId: string,
    input: Omit<AuditInput, "actorId" | "organizationId">,
  ): Promise<void> {
    const memberships = await this.prisma.client.organizationMember.findMany({
      select: { organizationId: true },
      where: {
        deletedAt: null,
        status: "ACTIVE",
        userId,
        organization: {
          deletedAt: null,
          status: "ACTIVE",
        },
      },
    });

    await Promise.all(
      memberships.map((membership) =>
        this.record({
          ...input,
          actorId: userId,
          organizationId: membership.organizationId,
        }),
      ),
    );
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}
