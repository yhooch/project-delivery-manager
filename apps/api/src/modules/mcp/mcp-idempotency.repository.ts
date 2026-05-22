import type { McpToolResult } from "@project-delivery/shared";

export const MCP_IDEMPOTENCY_REPOSITORY = Symbol(
  "MCP_IDEMPOTENCY_REPOSITORY",
);

export type McpToolInvocationResultStatus = "ERROR" | "PENDING" | "SUCCESS";

export type McpToolInvocationScope = {
  clientId: string;
  idempotencyKey: string;
  toolName: string;
  userId: string;
};

export type McpToolInvocationRecord = McpToolInvocationScope & {
  completedAt?: Date;
  errorCode?: string;
  id: string;
  inputSummary: Record<string, unknown>;
  organizationId: string;
  requestHash: string;
  requestId?: string;
  result?: unknown;
  resultStatus: McpToolInvocationResultStatus;
  spaceId: string;
};

export type ReserveMcpToolInvocationInput = McpToolInvocationScope & {
  inputSummary: Record<string, unknown>;
  organizationId: string;
  requestHash: string;
  requestId?: string;
  spaceId: string;
};

export type CompleteMcpToolInvocationInput = {
  errorCode?: string;
  invocationId: string;
  result: McpToolResult;
  resultStatus: Exclude<McpToolInvocationResultStatus, "PENDING">;
};

export type McpToolInvocationReservation =
  | {
      created: true;
      record: McpToolInvocationRecord;
    }
  | {
      created: false;
      record: McpToolInvocationRecord;
    };

export type McpIdempotencyRepository = {
  complete(
    input: CompleteMcpToolInvocationInput,
  ): Promise<McpToolInvocationRecord>;
  findByScope(
    input: McpToolInvocationScope,
  ): Promise<McpToolInvocationRecord | undefined>;
  reserve(
    input: ReserveMcpToolInvocationInput,
  ): Promise<McpToolInvocationReservation>;
};
