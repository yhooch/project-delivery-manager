import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  CompleteMcpToolInvocationInput,
  McpIdempotencyRepository,
  McpToolInvocationRecord,
  McpToolInvocationReservation,
  ReserveMcpToolInvocationInput,
} from "./mcp-idempotency.repository";

@Injectable()
export class PrismaMcpIdempotencyRepository
  implements McpIdempotencyRepository
{
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async reserve(
    input: ReserveMcpToolInvocationInput,
  ): Promise<McpToolInvocationReservation> {
    try {
      const record = await this.prisma.client.mcpToolInvocation.create({
        data: {
          id: ulid(),
          clientId: input.clientId,
          idempotencyKey: input.idempotencyKey,
          inputSummary: toJson(input.inputSummary),
          organizationId: input.organizationId,
          requestHash: input.requestHash,
          requestId: input.requestId,
          resultStatus: "PENDING",
          source: "MCP",
          spaceId: input.spaceId,
          toolName: input.toolName,
          userId: input.userId,
        },
      });

      return {
        created: true,
        record: toRecord(record),
      };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }

      const record = await this.findByScope(input);

      if (!record) {
        throw error;
      }

      return {
        created: false,
        record,
      };
    }
  }

  async findByScope(
    input: Pick<
      ReserveMcpToolInvocationInput,
      "clientId" | "idempotencyKey" | "toolName" | "userId"
    >,
  ): Promise<McpToolInvocationRecord | undefined> {
    const record = await this.prisma.client.mcpToolInvocation.findUnique({
      where: {
        userId_clientId_toolName_idempotencyKey: {
          clientId: input.clientId,
          idempotencyKey: input.idempotencyKey,
          toolName: input.toolName,
          userId: input.userId,
        },
      },
    });

    return record ? toRecord(record) : undefined;
  }

  async complete(
    input: CompleteMcpToolInvocationInput,
  ): Promise<McpToolInvocationRecord> {
    const record = await this.prisma.client.mcpToolInvocation.update({
      data: {
        completedAt: new Date(),
        errorCode: input.errorCode,
        result: toJson(input.result),
        resultStatus: input.resultStatus,
      },
      where: {
        id: input.invocationId,
      },
    });

    return toRecord(record);
  }
}

function toRecord(record: {
  clientId: string;
  completedAt: Date | null;
  errorCode: string | null;
  id: string;
  idempotencyKey: string;
  inputSummary: unknown;
  organizationId: string;
  requestHash: string;
  requestId: string | null;
  result: unknown;
  resultStatus: string;
  spaceId: string;
  toolName: string;
  userId: string;
}): McpToolInvocationRecord {
  return {
    clientId: record.clientId,
    completedAt: record.completedAt ?? undefined,
    errorCode: record.errorCode ?? undefined,
    id: record.id,
    idempotencyKey: record.idempotencyKey,
    inputSummary: isRecord(record.inputSummary) ? record.inputSummary : {},
    organizationId: record.organizationId,
    requestHash: record.requestHash,
    requestId: record.requestId ?? undefined,
    result: record.result ?? undefined,
    resultStatus:
      record.resultStatus === "SUCCESS" || record.resultStatus === "ERROR"
        ? record.resultStatus
        : "PENDING",
    spaceId: record.spaceId,
    toolName: record.toolName,
    userId: record.userId,
  };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    isRecord(error) &&
    typeof error.code === "string" &&
    error.code === "P2002"
  );
}
