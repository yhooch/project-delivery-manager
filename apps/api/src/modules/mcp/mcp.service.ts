import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  ApiErrorCodeSchema,
  McpInitializedNotificationSchema,
  McpInitializeRequestSchema,
  McpInitializeResultSchema,
  McpJsonRpcRequestIdSchema,
  McpProtocolVersionSchema,
  McpToolErrorResultSchema,
  McpToolResultSchema,
  McpToolsListRequestSchema,
  McpToolsListResultSchema,
  type ApiErrorCode,
  type AppSession,
  type McpJsonRpcErrorCode,
  type McpJsonRpcResponse,
  type McpJsonRpcResponseId,
  type McpContext,
  type McpToolName,
  type McpToolResult,
  type DocumentListQuery,
  type ObjectCodeLookupQuery,
  type SpaceRole,
  type SpaceExceptionsViewQuery,
  type SpaceOverviewViewQuery,
  type TargetType,
  type VersionBoardViewQuery,
  type WorkbenchViewQuery,
} from "@project-delivery/shared";
import { mcpToolContracts, mcpToolRegistry } from "@project-delivery/shared";
import { z } from "zod";

import { ApiException } from "../../http/api-exception";
import type { McpOAuthPrincipalContext } from "../../http/request-context";
import { toSessionUser } from "../auth/auth-session.builder";
import type { RequestMetadata } from "../auth/auth-session.types";
import { BugService } from "../bug/bug.service";
import { DocumentService } from "../document/document.service";
import {
  USER_REPOSITORY,
  type UserRepository,
} from "../identity/identity.repository";
import { IntakeService } from "../intake/intake.service";
import { ObjectCodeService } from "../object-code/object-code.service";
import { AppSessionService } from "../organization/app-session.service";
import { RequirementService } from "../requirement/requirement.service";
import { SpaceService } from "../space/space.service";
import { TimelineService } from "../timeline/timeline.service";
import { VersionService } from "../version/version.service";
import { WorkItemService } from "../workitem/workitem.service";
import { McpWriteToolExecutor } from "./mcp-write-tool.executor";

type McpToolContract = (typeof mcpToolContracts)[number];
type ToolExecution = {
  message: string;
  output: unknown;
};
type RequirementGetToolInput = {
  requirementId: string;
};
type IntakeListToolInput = Parameters<IntakeService["list"]>[2] & {
  spaceId: string;
};
type WorkItemGetToolInput = {
  workItemId: string;
};
type BugGetToolInput = {
  bugId: string;
};
type DocumentGetToolInput = {
  documentId: string;
};
type DocumentSearchToolInput = DocumentListQuery & {
  spaceId: string;
};
type SpaceOverviewToolInput = SpaceOverviewViewQuery & {
  spaceId: string;
};
type SpaceExceptionsToolInput = SpaceExceptionsViewQuery & {
  spaceId: string;
};
type VersionBoardToolInput = VersionBoardViewQuery & {
  versionId: string;
};
type TimelineToolInput = {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  targetId: string;
  targetType: TargetType;
};

const MCP_AUTO_WRITABLE_SPACE_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
]);

export type McpHttpErrorBody = {
  code: ApiErrorCode;
  details?: unknown;
  message: string;
};

export type McpHandlerResult =
  | {
      body: McpJsonRpcResponse;
      kind: "json-rpc";
      status: HttpStatus.OK;
    }
  | {
      kind: "empty";
      status: HttpStatus.ACCEPTED;
    }
  | {
      body: McpHttpErrorBody;
      kind: "http-error";
      status: HttpStatus.BAD_REQUEST;
    }
  | {
      body: McpHttpErrorBody;
      challenge: {
        error: "insufficient_scope";
        errorDescription: string;
        scope: string;
      };
      kind: "auth-error";
      status: HttpStatus.FORBIDDEN;
    };

const JsonRpcEnvelopeSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.unknown().optional(),
    method: z.string().min(1),
  })
  .passthrough();

const RawToolsCallRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: McpJsonRpcRequestIdSchema,
    method: z.literal("tools/call"),
    params: z
      .object({
        name: z.string().min(1).max(128),
        _meta: z.record(z.string(), z.unknown()).optional(),
        arguments: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

@Injectable()
export class McpService {
  constructor(
    @Inject(AppSessionService)
    private readonly appSessions: AppSessionService,
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(ObjectCodeService)
    private readonly objectCodes: ObjectCodeService,
    @Inject(SpaceService)
    private readonly spaces: SpaceService,
    @Inject(VersionService)
    private readonly versions: VersionService,
    @Inject(RequirementService)
    private readonly requirements: RequirementService,
    @Inject(IntakeService)
    private readonly intakeItems: IntakeService,
    @Inject(WorkItemService)
    private readonly workItems: WorkItemService,
    @Inject(BugService)
    private readonly bugs: BugService,
    @Inject(DocumentService)
    private readonly documents: DocumentService,
    @Inject(TimelineService)
    private readonly timelines: TimelineService,
    @Inject(McpWriteToolExecutor)
    private readonly writeTools: McpWriteToolExecutor,
  ) {}

  async handle(
    message: unknown,
    principal: McpOAuthPrincipalContext,
    protocolVersionHeader: string | undefined,
    requestMetadata: RequestMetadata = {},
  ): Promise<McpHandlerResult> {
    const envelope = JsonRpcEnvelopeSchema.safeParse(message);

    if (!envelope.success) {
      return rpcError(
        resolveResponseId(message),
        -32600,
        "Invalid JSON-RPC request.",
        { issues: formatZodIssues(envelope.error) },
      );
    }

    if (envelope.data.method !== "initialize") {
      const protocol = validateProtocolVersionHeader(protocolVersionHeader);

      if (!protocol.ok) {
        return protocol.error;
      }
    }

    switch (envelope.data.method) {
      case "initialize":
        return this.initialize(message);
      case "notifications/initialized":
        return this.initialized(message);
      case "tools/list":
        return this.listTools(message);
      case "tools/call":
        return this.callTool(message, principal, requestMetadata);
      default:
        return rpcError(
          resolveResponseId(message),
          -32601,
          "Method not found.",
        );
    }
  }

  private initialize(message: unknown): McpHandlerResult {
    const parsed = McpInitializeRequestSchema.safeParse(message);

    if (!parsed.success) {
      return rpcError(
        resolveResponseId(message),
        -32602,
        "Invalid initialize params.",
        { issues: formatZodIssues(parsed.error) },
      );
    }

    const result = McpInitializeResultSchema.parse({
      protocolVersion: parsed.data.params.protocolVersion,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "pdm",
        version: "0.1.0",
      },
      instructions:
        "Use tools/list to discover available PDM tools before calling tools.",
    });

    return rpcSuccess(parsed.data.id, result);
  }

  private initialized(message: unknown): McpHandlerResult {
    const parsed = McpInitializedNotificationSchema.safeParse(message);

    if (!parsed.success) {
      return rpcError(null, -32600, "Invalid initialized notification.", {
        issues: formatZodIssues(parsed.error),
      });
    }

    return {
      kind: "empty",
      status: HttpStatus.ACCEPTED,
    };
  }

  private listTools(message: unknown): McpHandlerResult {
    const parsed = McpToolsListRequestSchema.safeParse(message);

    if (!parsed.success) {
      return rpcError(
        resolveResponseId(message),
        -32602,
        "Invalid tools/list params.",
        { issues: formatZodIssues(parsed.error) },
      );
    }

    return rpcSuccess(
      parsed.data.id,
      McpToolsListResultSchema.parse({
        tools: mcpToolRegistry,
      }),
    );
  }

  private async callTool(
    message: unknown,
    principal: McpOAuthPrincipalContext,
    requestMetadata: RequestMetadata,
  ): Promise<McpHandlerResult> {
    const parsed = RawToolsCallRequestSchema.safeParse(message);

    if (!parsed.success) {
      return rpcError(
        resolveResponseId(message),
        -32602,
        "Invalid tools/call params.",
        { issues: formatZodIssues(parsed.error) },
      );
    }

    const contract = findToolContract(parsed.data.params.name);

    if (!contract) {
      return rpcSuccess(
        parsed.data.id,
        toolError(
          "MCP_TOOL_NOT_FOUND",
          `MCP tool is not registered: ${parsed.data.params.name}`,
        ),
      );
    }

    const missingScope = contract.scopes.find(
      (scope) => !principal.scopes.includes(scope),
    );

    if (missingScope) {
      const requiredScope = contract.scopes.join(" ");

      return {
        body: {
          code: "MCP_INSUFFICIENT_SCOPE",
          message: "Bearer token does not include the required scope.",
        },
        challenge: {
          error: "insufficient_scope",
          errorDescription:
            "Bearer token does not include the required scope.",
          scope: requiredScope,
        },
        kind: "auth-error",
        status: HttpStatus.FORBIDDEN,
      };
    }

    const args = parsed.data.params.arguments ?? {};

    if (!isRecord(args)) {
      return rpcSuccess(
        parsed.data.id,
        toolError("MCP_TOOL_ARGUMENT_INVALID", "Tool arguments must be an object."),
      );
    }

    const validArgs = contract.inputSchema.safeParse(args);

    if (!validArgs.success) {
      return rpcSuccess(
        parsed.data.id,
        toolError("MCP_TOOL_ARGUMENT_INVALID", "Tool arguments are invalid.", {
          issues: formatZodIssues(validArgs.error),
        }),
      );
    }

    try {
      return rpcSuccess(
        parsed.data.id,
        await this.executeTool(
          contract,
          validArgs.data,
          principal,
          requestMetadata,
        ),
      );
    } catch (error) {
      return rpcSuccess(parsed.data.id, toolErrorFromException(error));
    }
  }

  private async executeTool(
    contract: McpToolContract,
    args: unknown,
    principal: McpOAuthPrincipalContext,
    requestMetadata: RequestMetadata,
  ): Promise<McpToolResult> {
    if (this.writeTools.canExecute(contract.name)) {
      return this.writeTools.execute(contract, args, principal, requestMetadata);
    }

    const execution = await this.executeToolRaw(contract, args, principal);

    if (!execution) {
      return toolError(
        "INTERNAL_SERVER_ERROR",
        `${contract.name} executor is not implemented in this phase.`,
      );
    }

    const validatedOutput = contract.outputSchema.safeParse(execution.output);

    if (!validatedOutput.success) {
      return toolError("INTERNAL_SERVER_ERROR", "Tool output validation failed.", {
        issues: formatZodIssues(validatedOutput.error),
      });
    }

    return toolSuccess(execution.message, validatedOutput.data);
  }

  private async executeToolRaw(
    contract: McpToolContract,
    args: unknown,
    principal: McpOAuthPrincipalContext,
  ): Promise<ToolExecution | undefined> {
    switch (contract.name) {
      case "pdm.context.get":
        return {
          message: "PDM context returned.",
          output: await this.getContext(principal),
        };
      case "pdm.object.lookup_code":
        return {
          message: "Object code resolved.",
          output: await this.objectCodes.lookup(
            principal.userId,
            args as ObjectCodeLookupQuery,
          ),
        };
      case "pdm.workbench.get":
        return {
          message: "Workbench returned.",
          output: await this.spaces.getMyWorkbench(
            principal.userId,
            args as WorkbenchViewQuery,
          ),
        };
      case "pdm.space.overview_get": {
        const { spaceId, ...query } = args as SpaceOverviewToolInput;

        return {
          message: "Space overview returned.",
          output: await this.spaces.getOverview(
            principal.userId,
            spaceId,
            query,
          ),
        };
      }
      case "pdm.version.board_get": {
        const { versionId, ...query } = args as VersionBoardToolInput;

        return {
          message: "Version board returned.",
          output: await this.versions.getBoard(
            principal.userId,
            versionId,
            query,
          ),
        };
      }
      case "pdm.exceptions.list": {
        const { spaceId, ...query } = args as SpaceExceptionsToolInput;

        return {
          message: "Space exceptions returned.",
          output: await this.spaces.getExceptions(
            principal.userId,
            spaceId,
            query,
          ),
        };
      }
      case "pdm.requirement.get":
        return {
          message: "Requirement returned.",
          output: await this.requirements.get(
            principal.userId,
            (args as RequirementGetToolInput).requirementId,
          ),
        };
      case "pdm.intake.list": {
        const { spaceId, ...query } = args as IntakeListToolInput;

        return {
          message: "Intake items returned.",
          output: await this.intakeItems.list(
            principal.userId,
            spaceId,
            query,
          ),
        };
      }
      case "pdm.work_item.get":
        return {
          message: "Work item returned.",
          output: await this.workItems.get(
            principal.userId,
            (args as WorkItemGetToolInput).workItemId,
          ),
        };
      case "pdm.bug.get":
        return {
          message: "Bug returned.",
          output: await this.bugs.get(
            principal.userId,
            (args as BugGetToolInput).bugId,
          ),
        };
      case "pdm.document.search": {
        const { spaceId, ...query } = args as DocumentSearchToolInput;

        return {
          message: "Documents returned.",
          output: await this.documents.list(principal.userId, spaceId, query),
        };
      }
      case "pdm.document.get":
        return {
          message: "Document returned.",
          output: await this.documents.get(
            principal.userId,
            (args as DocumentGetToolInput).documentId,
          ),
        };
      case "pdm.timeline.list":
        return {
          message: "Timeline returned.",
          output: await this.timelines.list(
            principal.userId,
            args as TimelineToolInput,
          ),
        };
      default:
        return undefined;
    }
  }

  private async getContext(principal: McpOAuthPrincipalContext) {
    const user = await this.users.findById(principal.userId);

    if (!user || user.status !== "ACTIVE") {
      throw new ApiException(
        "MCP_UNAUTHORIZED",
        "Bearer token user is no longer available.",
        HttpStatus.UNAUTHORIZED,
      );
    }

    const session = await this.appSessions.buildForUser(toSessionUser(user));

    return toMcpContext(session);
  }
}

function toMcpContext(session: AppSession): McpContext {
  const writableSpaces = session.spaces.filter(
    (space) =>
      space.status === "ACTIVE" &&
      MCP_AUTO_WRITABLE_SPACE_ROLES.has(space.role),
  );
  const hasSingleCandidate =
    session.organizations.length === 1 && session.spaces.length === 1;

  return {
    user: session.user,
    organizations: session.organizations,
    spaces: session.spaces,
    readSuggestedOrganizationId: session.defaultOrganizationId,
    readSuggestedSpaceId: session.defaultSpaceId,
    writableSpaceCount: writableSpaces.length,
    singleWritableSpaceId:
      writableSpaces.length === 1 ? writableSpaces[0]?.id : undefined,
    selectionSource: hasSingleCandidate ? "SINGLE_CANDIDATE" : "FALLBACK",
    writeRequiresExplicitTarget: true,
    capabilities: session.capabilities,
  };
}

function validateProtocolVersionHeader(
  value: string | undefined,
):
  | {
      ok: true;
    }
  | {
      error: Extract<McpHandlerResult, { kind: "http-error" }>;
      ok: false;
    } {
  if (!value || value.trim() === "") {
    return { ok: true };
  }

  if (!McpProtocolVersionSchema.safeParse(value.trim()).success) {
    return {
      error: {
        body: {
          code: "BAD_REQUEST",
          message: "Unsupported MCP protocol version.",
        },
        kind: "http-error",
        status: HttpStatus.BAD_REQUEST,
      },
      ok: false,
    };
  }

  return { ok: true };
}

function findToolContract(name: string): McpToolContract | undefined {
  return mcpToolContracts.find(
    (contract) => contract.name === (name as McpToolName),
  );
}

function rpcSuccess(
  id: McpJsonRpcResponseId,
  result: unknown,
): Extract<McpHandlerResult, { kind: "json-rpc" }> {
  return {
    body: {
      jsonrpc: "2.0",
      id,
      result,
    },
    kind: "json-rpc",
    status: HttpStatus.OK,
  };
}

function rpcError(
  id: McpJsonRpcResponseId,
  code: McpJsonRpcErrorCode,
  message: string,
  data?: unknown,
): Extract<McpHandlerResult, { kind: "json-rpc" }> {
  return {
    body: {
      jsonrpc: "2.0",
      id,
      error: data === undefined ? { code, message } : { code, data, message },
    },
    kind: "json-rpc",
    status: HttpStatus.OK,
  };
}

function resolveResponseId(message: unknown): McpJsonRpcResponseId {
  if (!isRecord(message)) {
    return null;
  }

  const parsed = McpJsonRpcRequestIdSchema.safeParse(message.id);

  return parsed.success ? parsed.data : null;
}

function toolSuccess(message: string, output: unknown): McpToolResult {
  return McpToolResultSchema.parse({
    content: [
      {
        type: "text",
        text: truncateContentText(message),
      },
    ],
    structuredContent: toStructuredContent(output),
  });
}

function toolError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): McpToolResult {
  return McpToolErrorResultSchema.parse({
    content: [
      {
        type: "text",
        text: truncateContentText(message),
      },
    ],
    structuredContent: {
      error:
        details === undefined
          ? {
              code,
              message,
            }
          : {
              code,
              details,
              message,
            },
    },
    isError: true,
  });
}

function toolErrorFromException(error: unknown): McpToolResult {
  if (error instanceof ApiException && ApiErrorCodeSchema.safeParse(error.code).success) {
    return toolError(error.code, error.message, error.details);
  }

  return toolError("INTERNAL_SERVER_ERROR", "Tool execution failed.");
}

function formatZodIssues(error: z.ZodError): Array<{
  code: string;
  message: string;
  path: string[];
}> {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String),
  }));
}

function toStructuredContent(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function truncateContentText(value: string): string {
  return value.length <= 4000 ? value : `${value.slice(0, 3997)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
