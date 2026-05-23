import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  ApiErrorCodeSchema,
  CreateCommentRequestSchema,
  McpDryRunResultSchema,
  McpToolErrorResultSchema,
  McpToolResultSchema,
  McpWriteContextSchema,
  mcpToolContracts,
  type ApiErrorCode,
  type CreateBugRequest,
  type CreateIntakeItemRequest,
  type CreateWorkItemRequest,
  type ExecuteActionRequest,
  type McpCreateRequirementRequest,
  type McpToolName,
  type McpToolResult,
  type McpWriteContext,
  type ReplaceTagAssignmentsRequest,
  type TargetType,
  type UpdateWorkItemRequest,
} from "@project-delivery/shared";
import { createHash } from "node:crypto";
import { z } from "zod";

import { ApiException } from "../../http/api-exception";
import type { McpOAuthPrincipalContext } from "../../http/request-context";
import type { RequestMetadata } from "../auth/auth-session.types";
import { BugService } from "../bug/bug.service";
import { CommentService } from "../comment/comment.service";
import { IntakeService } from "../intake/intake.service";
import { RequirementService } from "../requirement/requirement.service";
import { SpaceService } from "../space/space.service";
import { TagAssignmentService } from "../tag/tag-assignment.service";
import { TargetResolverService } from "../target/target-resolver.service";
import { WorkflowActionExecutionService } from "../workflow/workflow-action-execution.service";
import { WorkItemService } from "../workitem/workitem.service";
import { McpIdempotencyService } from "./mcp-idempotency.service";

type McpToolContract = (typeof mcpToolContracts)[number];
type ToolExecution = {
  message: string;
  output: unknown;
};
type McpBusinessMetadata = RequestMetadata & {
  metadata: Record<string, unknown>;
};
type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;
type CreateIntakeArgs = McpWriteContext & CreateIntakeItemRequest;
type CreateTaskArgs = McpWriteContext & CreateWorkItemRequest;
type CreateBugArgs = McpWriteContext & CreateBugRequest;
type CreateCommentArgs = McpWriteContext & CreateCommentRequest;
type ReplaceTagAssignmentsArgs = McpWriteContext &
  ReplaceTagAssignmentsRequest;
type UpdateWorkItemArgs = McpWriteContext &
  UpdateWorkItemRequest & {
    workItemId: string;
  };
type ExecuteWorkItemActionArgs = McpWriteContext &
  ExecuteActionRequest & {
    actionId: string;
    workItemId: string;
  };

const WRITE_TOOL_NAMES = new Set<McpToolName>([
  "pdm.requirement.create",
  "pdm.intake.create",
  "pdm.work_item.create_task",
  "pdm.work_item.update",
  "pdm.work_item.execute_action",
  "pdm.bug.create",
  "pdm.comment.create",
  "pdm.tag.replace_assignments",
]);

@Injectable()
export class McpWriteToolExecutor {
  constructor(
    @Inject(McpIdempotencyService)
    private readonly idempotency: McpIdempotencyService,
    @Inject(SpaceService)
    private readonly spaces: SpaceService,
    @Inject(RequirementService)
    private readonly requirements: RequirementService,
    @Inject(IntakeService)
    private readonly intakeItems: IntakeService,
    @Inject(WorkItemService)
    private readonly workItems: WorkItemService,
    @Inject(BugService)
    private readonly bugs: BugService,
    @Inject(CommentService)
    private readonly comments: CommentService,
    @Inject(TagAssignmentService)
    private readonly tagAssignments: TagAssignmentService,
    @Inject(WorkflowActionExecutionService)
    private readonly workflowActions: WorkflowActionExecutionService,
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
  ) {}

  canExecute(name: McpToolName): boolean {
    return WRITE_TOOL_NAMES.has(name);
  }

  async execute(
    contract: McpToolContract,
    args: unknown,
    principal: McpOAuthPrincipalContext,
    requestMetadata: RequestMetadata,
  ): Promise<McpToolResult> {
    const writeContext = parseWriteContext(args);
    const scope = {
      clientId: principal.clientId,
      idempotencyKey: writeContext.idempotencyKey,
      toolName: contract.name,
      userId: principal.userId,
    };
    const inputSummary = summarizeInput(contract.name, args);
    const reservation = await this.idempotency.reserve({
      ...scope,
      inputSummary,
      organizationId: writeContext.organizationId,
      requestHash: hashRequest(args),
      requestId: requestMetadata.requestId,
      spaceId: writeContext.spaceId,
    });

    switch (reservation.kind) {
      case "conflict":
        return toolError(
          "MCP_IDEMPOTENCY_CONFLICT",
          reservation.details.message,
          reservation.details,
        );
      case "pending": {
        const replay = await this.idempotency.waitForReplay(scope);

        return (
          replay ??
          toolError(
            "CONFLICT",
            "An invocation with the same idempotency key is still in progress.",
          )
        );
      }
      case "replay":
        return reservation.result;
      case "reserved": {
        const result =
          writeContext.dryRun === true
            ? await this.executeDryRun(contract, args, principal, writeContext)
            : await this.invokeWriteTool(
                contract,
                args,
                principal,
                requestMetadata,
                inputSummary,
              );
        await this.idempotency.complete({
          invocationId: reservation.invocationId,
          result,
        });
        return result;
      }
    }
  }

  private async executeDryRun(
    contract: McpToolContract,
    args: unknown,
    principal: McpOAuthPrincipalContext,
    writeContext: McpWriteContext,
  ): Promise<McpToolResult> {
    const validationResult = await this.invokeAsToolResult(contract, async () => {
      await this.validateContextOnly(contract.name, args, principal);

      return {
        message: "Dry run validated. No business changes were committed.",
        output: McpDryRunResultSchema.parse({
          committed: false,
          dryRun: true,
          message: "Input schema and accessible organization/space context validated.",
          organizationId: writeContext.organizationId,
          spaceId: writeContext.spaceId,
          toolName: contract.name,
          validated: ["inputSchema", "spaceContext"],
        }),
      };
    });

    return validationResult;
  }

  private async invokeWriteTool(
    contract: McpToolContract,
    args: unknown,
    principal: McpOAuthPrincipalContext,
    requestMetadata: RequestMetadata,
    inputSummary: Record<string, unknown>,
  ): Promise<McpToolResult> {
    return this.invokeAsToolResult(contract, async () => {
      await this.validateContextOnly(contract.name, args, principal);

      const context = parseWriteContext(args);
      const metadata = buildBusinessMetadata({
        clientId: principal.clientId,
        inputSummary,
        organizationId: context.organizationId,
        requestMetadata,
        spaceId: context.spaceId,
        toolName: contract.name,
        userId: principal.userId,
      });

      return this.executeBusinessWrite(contract.name, args, principal, metadata);
    });
  }

  private async invokeAsToolResult(
    contract: McpToolContract,
    invoke: () => Promise<ToolExecution>,
  ): Promise<McpToolResult> {
    try {
      const execution = await invoke();
      const validatedOutput = contract.outputSchema.safeParse(execution.output);

      if (!validatedOutput.success) {
        return toolError(
          "INTERNAL_SERVER_ERROR",
          "Tool output validation failed.",
          { issues: formatZodIssues(validatedOutput.error) },
        );
      }

      return toolSuccess(execution.message, validatedOutput.data);
    } catch (error) {
      return toolErrorFromException(error);
    }
  }

  private async validateContextOnly(
    toolName: McpToolName,
    args: unknown,
    principal: McpOAuthPrincipalContext,
  ): Promise<void> {
    const context = parseWriteContext(args);

    await this.spaces.getOverview(principal.userId, context.spaceId, {
      organizationId: context.organizationId,
    });

    switch (toolName) {
      case "pdm.comment.create": {
        const input = args as CreateCommentArgs;
        await this.validateTargetContext(
          principal.userId,
          input.targetType,
          input.targetId,
          context,
        );
        return;
      }
      case "pdm.tag.replace_assignments": {
        const input = args as ReplaceTagAssignmentsArgs;
        await this.validateTargetContext(
          principal.userId,
          input.targetType,
          input.targetId,
          context,
        );
        return;
      }
      case "pdm.work_item.update":
      case "pdm.work_item.execute_action": {
        const input = args as UpdateWorkItemArgs | ExecuteWorkItemActionArgs;
        await this.validateTargetContext(
          principal.userId,
          "WORK_ITEM",
          input.workItemId,
          context,
        );
        return;
      }
      default:
        return;
    }
  }

  private async validateTargetContext(
    actorUserId: string,
    targetType: TargetType,
    targetId: string,
    context: McpWriteContext,
  ): Promise<void> {
    const target = await this.targets.resolve(actorUserId, targetType, targetId);

    if (
      target.organizationId !== context.organizationId ||
      target.spaceId !== context.spaceId
    ) {
      throw new ApiException(
        "SPACE_ACCESS_DENIED",
        "Target does not belong to the provided MCP organization and space context.",
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async executeBusinessWrite(
    toolName: McpToolName,
    args: unknown,
    principal: McpOAuthPrincipalContext,
    metadata: McpBusinessMetadata,
  ): Promise<ToolExecution> {
    switch (toolName) {
      case "pdm.requirement.create": {
        const input = args as McpCreateRequirementRequest;
        await this.requirements.validateCreateRequest(
          principal.userId,
          input.spaceId,
          {
            contentFormat: "MARKDOWN",
            contentMarkdown: input.contentMarkdown,
            ownerId: input.ownerId,
            priority: input.priority,
            summary: input.summary,
            tagIds: input.tagIds,
            title: input.title,
            versionId: input.versionId,
          },
          metadata,
        );
        const draft = await this.requirements.createDraft(
          principal.userId,
          input.spaceId,
          {
            tagIds: input.tagIds,
            versionId: input.versionId,
          },
          metadata,
        );
        const requirement = await this.requirements.update(
          principal.userId,
          draft.id,
          {
            contentFormat: "MARKDOWN",
            contentMarkdown: input.contentMarkdown,
            ownerId: input.ownerId,
            priority: input.priority,
            summary: input.summary,
            title: input.title,
            versionId: input.versionId,
          },
          metadata,
        );

        return {
          message: "Requirement created.",
          output: requirement,
        };
      }
      case "pdm.intake.create": {
        const input = args as CreateIntakeArgs;
        const item = await this.intakeItems.create(
          principal.userId,
          input.spaceId,
          omitWriteContext(input),
          metadata,
        );

        return {
          message: "Intake item created.",
          output: item,
        };
      }
      case "pdm.work_item.create_task": {
        const input = args as CreateTaskArgs;
        const workItem = await this.workItems.create(
          principal.userId,
          input.spaceId,
          omitWriteContext(input),
          metadata,
        );

        return {
          message: "Task created.",
          output: workItem,
        };
      }
      case "pdm.bug.create": {
        const input = args as CreateBugArgs;
        const bug = await this.bugs.create(
          principal.userId,
          input.spaceId,
          omitWriteContext(input),
          metadata,
        );

        return {
          message: "Bug created.",
          output: bug,
        };
      }
      case "pdm.comment.create": {
        const input = args as CreateCommentArgs;
        const comment = await this.comments.create(
          principal.userId,
          omitWriteContext(input),
          metadata,
        );

        return {
          message: "Comment created.",
          output: comment,
        };
      }
      case "pdm.tag.replace_assignments": {
        const input = args as ReplaceTagAssignmentsArgs;
        const assignments = await this.tagAssignments.replace(
          principal.userId,
          omitWriteContext(input),
          metadata,
        );

        return {
          message: "Tag assignments replaced.",
          output: assignments,
        };
      }
      case "pdm.work_item.update": {
        const input = args as UpdateWorkItemArgs;
        const { workItemId, ...updateInput } = omitWriteContext(input);
        const updated = await this.workItems.update(
          principal.userId,
          workItemId,
          updateInput,
          metadata,
        );
        const detail = await this.workItems.get(principal.userId, updated.id);

        return {
          message: "Work item updated.",
          output: detail,
        };
      }
      case "pdm.work_item.execute_action": {
        const input = args as ExecuteWorkItemActionArgs;
        const { actionId, workItemId, ...executeInput } =
          omitWriteContext(input);
        const detail = await this.workflowActions.executeAction(
          principal.userId,
          workItemId,
          actionId,
          executeInput,
          metadata,
        );

        return {
          message: "Workflow action executed.",
          output: detail,
        };
      }
      default:
        return {
          message: `${toolName} executor is not implemented in this phase.`,
          output: {},
        };
    }
  }
}

function omitWriteContext<TInput extends McpWriteContext>(
  input: TInput,
): Omit<TInput, keyof McpWriteContext> {
  const {
    dryRun: _dryRun,
    idempotencyKey: _idempotencyKey,
    organizationId: _organizationId,
    spaceId: _spaceId,
    ...rest
  } = input;

  return rest;
}

function parseWriteContext(args: unknown): McpWriteContext {
  if (!isRecord(args)) {
    return McpWriteContextSchema.parse(args);
  }

  return McpWriteContextSchema.parse({
    dryRun: args.dryRun,
    idempotencyKey: args.idempotencyKey,
    organizationId: args.organizationId,
    spaceId: args.spaceId,
  });
}

function buildBusinessMetadata(input: {
  clientId: string;
  inputSummary: Record<string, unknown>;
  organizationId: string;
  requestMetadata: RequestMetadata;
  spaceId: string;
  toolName: McpToolName;
  userId: string;
}): McpBusinessMetadata {
  return {
    ...input.requestMetadata,
    metadata: {
      clientId: input.clientId,
      inputSummary: input.inputSummary,
      organizationId: input.organizationId,
      requestId: input.requestMetadata.requestId,
      resultStatus: "SUCCESS",
      source: "MCP",
      spaceId: input.spaceId,
      toolName: input.toolName,
      userId: input.userId,
    },
  };
}

function summarizeInput(
  toolName: McpToolName,
  args: unknown,
): Record<string, unknown> {
  const record = isRecord(args) ? args : {};
  const textFields = ["body", "contentMarkdown", "description", "title"];
  const textSummary = Object.fromEntries(
    textFields
      .filter((key) => typeof record[key] === "string")
      .map((key) => [
        key,
        summarizeTextField(record[key] as string),
      ]),
  );

  return removeUndefined({
    dryRun: record.dryRun === true,
    fieldNames: Object.keys(record)
      .filter((key) => key !== "idempotencyKey")
      .sort(),
    idempotencyKey: record.idempotencyKey,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    targetId: record.targetId ?? record.workItemId,
    targetType: record.targetType,
    text: textSummary,
    toolName,
  });
}

function summarizeTextField(value: string): Record<string, unknown> {
  return {
    length: value.length,
    preview: value.slice(0, 120),
  };
}

function hashRequest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;

  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
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
  if (
    error instanceof ApiException &&
    ApiErrorCodeSchema.safeParse(error.code).success
  ) {
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

function removeUndefined<TValue extends Record<string, unknown>>(
  value: TValue,
): TValue {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as TValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
