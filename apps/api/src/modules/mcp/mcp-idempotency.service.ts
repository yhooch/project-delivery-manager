import { Inject, Injectable } from "@nestjs/common";
import {
  McpToolResultSchema,
  type McpIdempotencyConflictDetails,
  type McpToolResult,
} from "@project-delivery/shared";

import {
  MCP_IDEMPOTENCY_REPOSITORY,
  type McpIdempotencyRepository,
  type McpToolInvocationRecord,
  type McpToolInvocationScope,
  type ReserveMcpToolInvocationInput,
} from "./mcp-idempotency.repository";

const PENDING_REPLAY_ATTEMPTS = 20;
const PENDING_REPLAY_DELAY_MS = 100;

export type McpIdempotencyDecision =
  | {
      invocationId: string;
      kind: "reserved";
    }
  | {
      kind: "replay";
      result: McpToolResult;
    }
  | {
      details: McpIdempotencyConflictDetails;
      kind: "conflict";
    }
  | {
      kind: "pending";
    };

@Injectable()
export class McpIdempotencyService {
  constructor(
    @Inject(MCP_IDEMPOTENCY_REPOSITORY)
    private readonly invocations: McpIdempotencyRepository,
  ) {}

  async reserve(
    input: ReserveMcpToolInvocationInput,
  ): Promise<McpIdempotencyDecision> {
    const reservation = await this.invocations.reserve(input);

    if (reservation.created) {
      return {
        invocationId: reservation.record.id,
        kind: "reserved",
      };
    }

    if (reservation.record.requestHash !== input.requestHash) {
      return {
        details: {
          code: "MCP_IDEMPOTENCY_CONFLICT",
          idempotencyKey: input.idempotencyKey,
          message: "Same idempotency key was used with different arguments.",
          toolName: input.toolName,
        },
        kind: "conflict",
      };
    }

    const replay = parseCompletedResult(reservation.record);

    if (replay) {
      return {
        kind: "replay",
        result: replay,
      };
    }

    return {
      kind: "pending",
    };
  }

  async waitForReplay(
    scope: McpToolInvocationScope,
  ): Promise<McpToolResult | undefined> {
    for (let index = 0; index < PENDING_REPLAY_ATTEMPTS; index += 1) {
      await sleep(PENDING_REPLAY_DELAY_MS);

      const record = await this.invocations.findByScope(scope);
      const replay = record ? parseCompletedResult(record) : undefined;

      if (replay) {
        return replay;
      }
    }

    return undefined;
  }

  async complete(input: {
    invocationId: string;
    result: McpToolResult;
  }): Promise<void> {
    await this.invocations.complete({
      errorCode: getResultErrorCode(input.result),
      invocationId: input.invocationId,
      result: input.result,
      resultStatus: input.result.isError === true ? "ERROR" : "SUCCESS",
    });
  }
}

function parseCompletedResult(
  record: McpToolInvocationRecord,
): McpToolResult | undefined {
  if (record.resultStatus === "PENDING" || record.result === undefined) {
    return undefined;
  }

  const parsed = McpToolResultSchema.safeParse(record.result);

  return parsed.success ? parsed.data : undefined;
}

function getResultErrorCode(result: McpToolResult): string | undefined {
  if (result.isError !== true || !isRecord(result.structuredContent)) {
    return undefined;
  }

  const error = result.structuredContent.error;

  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
