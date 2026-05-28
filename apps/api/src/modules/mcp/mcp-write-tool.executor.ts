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
  type McpAppendDocumentContentRequest,
  type McpCreateDocumentFolderRequest,
  type McpCreateDocumentFromMarkdownRequest,
  type McpCreateRequirementRequest,
  type McpDeleteDocumentFolderRequest,
  type McpLinkDocumentResourcesRequest,
  type McpMoveDocumentFolderRequest,
  type McpMoveDocumentToFolderRequest,
  type McpReplaceDocumentContentRequest,
  type McpToolName,
  type McpToolResult,
  type McpUpdateDocumentFolderRequest,
  type McpUpdateDocumentMetadataRequest,
  type McpWriteContext,
  type McpWriteTargetSelectionSource,
  type ReplaceTagAssignmentsRequest,
  type SpaceRole,
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
import { DocumentFolderService } from "../document/document-folder.service";
import { DocumentService } from "../document/document.service";
import { IntakeService } from "../intake/intake.service";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
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
type WriteTargetSelectionValidation =
  | {
      accepted: true;
      organizationName?: string;
      reason: string;
      spaceName?: string;
      source: Exclude<
        McpWriteTargetSelectionSource,
        "MCP_CONTEXT_FALLBACK"
      >;
    }
  | {
      accepted: false;
      details: Record<string, unknown>;
      message: string;
      organizationName?: string;
      reason: string;
      spaceName?: string;
      source?: McpWriteTargetSelectionSource;
    };
type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;
type CreateIntakeArgs = McpWriteContext & CreateIntakeItemRequest;
type CreateTaskArgs = McpWriteContext & CreateWorkItemRequest;
type CreateBugArgs = McpWriteContext & CreateBugRequest;
type CreateCommentArgs = McpWriteContext & CreateCommentRequest;
type CreateDocumentFolderArgs = McpCreateDocumentFolderRequest;
type DeleteDocumentFolderArgs = McpDeleteDocumentFolderRequest;
type MoveDocumentFolderArgs = McpMoveDocumentFolderRequest;
type MoveDocumentToFolderArgs = McpMoveDocumentToFolderRequest;
type ReplaceTagAssignmentsArgs = McpWriteContext &
  ReplaceTagAssignmentsRequest;
type UpdateDocumentFolderArgs = McpUpdateDocumentFolderRequest;
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
  "pdm.document_folder.create",
  "pdm.document_folder.update",
  "pdm.document_folder.move",
  "pdm.document_folder.delete",
  "pdm.document.create_from_markdown",
  "pdm.document.append_content",
  "pdm.document.replace_content",
  "pdm.document.update_metadata",
  "pdm.document.link_resources",
  "pdm.document.move_to_folder",
  "pdm.tag.replace_assignments",
]);

const MCP_AUTO_WRITABLE_SPACE_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
]);

@Injectable()
export class McpWriteToolExecutor {
  constructor(
    @Inject(McpIdempotencyService)
    private readonly idempotency: McpIdempotencyService,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
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
    @Inject(DocumentFolderService)
    private readonly documentFolders: DocumentFolderService,
    @Inject(DocumentService)
    private readonly documents: DocumentService,
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

  private async inspectWriteTargetSelection(
    userId: string,
    context: McpWriteContext,
  ): Promise<WriteTargetSelectionValidation> {
    const [organizations, spaces] = await Promise.all([
      this.organizations.listSessionSummaries(userId),
      this.organizations.listSessionSpaceSummaries(userId),
    ]);
    const organization = organizations.find(
      (item) => item.id === context.organizationId,
    );
    const space = spaces.find((item) => item.id === context.spaceId);

    if (!organization || !space || space.organizationId !== organization.id) {
      throw new ApiException(
        "SPACE_ACCESS_DENIED",
        "MCP write target is not an accessible organization and project space pair.",
        HttpStatus.FORBIDDEN,
        {
          organizationId: context.organizationId,
          spaceId: context.spaceId,
        },
      );
    }

    const writableSpaces = spaces.filter(
      (item) =>
        item.status === "ACTIVE" &&
        MCP_AUTO_WRITABLE_SPACE_ROLES.has(item.role),
    );
    const sharedDetails = {
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      targetOrganizationName: organization.name,
      targetSelectionSource: context.targetSelectionSource ?? "MISSING",
      targetSpaceName: space.name,
      writableSpaceCount: writableSpaces.length,
    };

    if (context.targetSelectionSource === "USER_EXPLICIT") {
      return {
        accepted: true,
        organizationName: organization.name,
        reason: "The MCP write target was explicitly selected by the user.",
        source: "USER_EXPLICIT",
        spaceName: space.name,
      };
    }

    if (context.targetSelectionSource === "SINGLE_WRITABLE_SPACE") {
      const onlyWritableSpace = writableSpaces[0];

      if (
        writableSpaces.length === 1 &&
        onlyWritableSpace?.id === context.spaceId &&
        onlyWritableSpace.organizationId === context.organizationId
      ) {
        return {
          accepted: true,
          organizationName: organization.name,
          reason: "The user has exactly one writable project space.",
          source: "SINGLE_WRITABLE_SPACE",
          spaceName: space.name,
        };
      }

      return {
        accepted: false,
        details: {
          ...sharedDetails,
          allowedSources: ["USER_EXPLICIT"],
        },
        message:
          "MCP write target must be explicitly selected when more than one writable project space is available.",
        organizationName: organization.name,
        reason:
          "Multiple or mismatched writable project spaces require the user to choose the organization and project space.",
        source: context.targetSelectionSource,
        spaceName: space.name,
      };
    }

    return {
      accepted: false,
      details: {
        ...sharedDetails,
        allowedSources: ["USER_EXPLICIT", "SINGLE_WRITABLE_SPACE"],
      },
      message:
        "MCP write target must be explicitly selected. Do not use pdm.context.get fallback suggestions as write targets.",
      organizationName: organization.name,
      reason:
        "The provided target selection source is missing or is a context fallback suggestion.",
      source: context.targetSelectionSource,
      spaceName: space.name,
    };
  }

  async execute(
    contract: McpToolContract,
    args: unknown,
    principal: McpOAuthPrincipalContext,
    requestMetadata: RequestMetadata,
  ): Promise<McpToolResult> {
    let writeContext: McpWriteContext;
    let targetSelection: WriteTargetSelectionValidation;

    try {
      writeContext = parseWriteContext(args);
      targetSelection = await this.inspectWriteTargetSelection(
        principal.userId,
        writeContext,
      );
    } catch (error) {
      return toolErrorFromException(error);
    }

    if (!targetSelection.accepted) {
      if (writeContext.dryRun === true) {
        return toolSuccess(
          "Dry run requires an explicit MCP write target.",
          dryRunSelectionResult(contract.name, writeContext, targetSelection),
        );
      }

      return toolError(
        "SPACE_CONTEXT_REQUIRED",
        targetSelection.message,
        targetSelection.details,
      );
    }

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
            ? await this.executeDryRun(
                contract,
                args,
                principal,
                writeContext,
                targetSelection,
              )
            : await this.invokeWriteTool(
                contract,
                args,
                principal,
                requestMetadata,
                inputSummary,
                targetSelection,
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
    targetSelection: Extract<WriteTargetSelectionValidation, { accepted: true }>,
  ): Promise<McpToolResult> {
    const validationResult = await this.invokeAsToolResult(contract, async () => {
      await this.validateContextOnly(contract.name, args, principal);

      return {
        message: "Dry run validated. No business changes were committed.",
        output: McpDryRunResultSchema.parse({
          canWrite: true,
          committed: false,
          dryRun: true,
          message:
            "Input schema, target selection and accessible organization/space context validated.",
          organizationId: writeContext.organizationId,
          reason: targetSelection.reason,
          requiresConfirmation: false,
          spaceId: writeContext.spaceId,
          targetOrganizationName: targetSelection.organizationName,
          targetSelectionSource: targetSelection.source,
          targetSpaceName: targetSelection.spaceName,
          toolName: contract.name,
          validated: ["inputSchema", "targetSelection", "spaceContext"],
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
    targetSelection: Extract<WriteTargetSelectionValidation, { accepted: true }>,
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
        targetSelectionSource: targetSelection.source,
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
      case "pdm.document.append_content":
      case "pdm.document.replace_content": {
        const input = args as
          | McpAppendDocumentContentRequest
          | McpReplaceDocumentContentRequest;
        await this.validateDocumentContext(
          principal.userId,
          input.documentId,
          context,
          input.baseRevision,
        );
        return;
      }
      case "pdm.document.update_metadata": {
        const input = args as McpUpdateDocumentMetadataRequest;
        await this.validateDocumentContext(
          principal.userId,
          input.documentId,
          context,
        );
        await this.validateDocumentLinkTargets(
          principal.userId,
          input.links,
          input.documentId,
          context,
        );
        return;
      }
      case "pdm.document.link_resources": {
        const input = args as McpLinkDocumentResourcesRequest;
        await this.validateDocumentContext(
          principal.userId,
          input.documentId,
          context,
          input.baseRevision,
        );
        await this.validateDocumentLinkTargets(
          principal.userId,
          input.links,
          input.documentId,
          context,
        );
        return;
      }
      case "pdm.document_folder.create": {
        const input = args as CreateDocumentFolderArgs;
        await this.validateDocumentFolderContext(
          input.parentId,
          context,
        );
        return;
      }
      case "pdm.document_folder.update":
      case "pdm.document_folder.delete": {
        const input = args as UpdateDocumentFolderArgs | DeleteDocumentFolderArgs;
        await this.validateDocumentFolderContext(
          input.folderId,
          context,
        );
        return;
      }
      case "pdm.document_folder.move": {
        const input = args as MoveDocumentFolderArgs;
        await this.validateDocumentFolderContext(
          input.folderId,
          context,
        );
        await this.validateDocumentFolderContext(
          input.parentId ?? undefined,
          context,
        );
        return;
      }
      case "pdm.document.move_to_folder": {
        const input = args as MoveDocumentToFolderArgs;
        await this.validateDocumentContext(
          principal.userId,
          input.documentId,
          context,
          input.baseRevision,
        );
        await this.validateDocumentFolderContext(
          input.folderId ?? undefined,
          context,
        );
        return;
      }
      case "pdm.document.create_from_markdown": {
        const input = args as McpCreateDocumentFromMarkdownRequest;
        if (input.folderId) {
          await this.validateDocumentFolderContext(
            input.folderId,
            context,
          );
        }
        await this.validateDocumentLinkTargets(
          principal.userId,
          input.links,
          undefined,
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

  private async validateDocumentContext(
    actorUserId: string,
    documentId: string,
    context: McpWriteContext,
    baseRevision?: number,
  ): Promise<void> {
    const document = await this.documents.get(actorUserId, documentId);

    if (
      document.organizationId !== context.organizationId ||
      document.spaceId !== context.spaceId
    ) {
      throw new ApiException(
        "SPACE_ACCESS_DENIED",
        "Document does not belong to the provided MCP organization and space context.",
        HttpStatus.FORBIDDEN,
      );
    }

    if (baseRevision !== undefined && document.revision !== baseRevision) {
      throw new ApiException(
        "DOCUMENT_EDIT_CONFLICT",
        "Document revision conflict",
        HttpStatus.CONFLICT,
      );
    }
  }

  private async validateDocumentFolderContext(
    folderId: string | undefined,
    context: McpWriteContext,
  ): Promise<void> {
    if (!folderId) {
      return;
    }

    await this.documentFolders.requireFolderInSpace(folderId, {
      organizationId: context.organizationId,
      spaceId: context.spaceId,
    });
  }

  private async validateDocumentLinkTargets(
    actorUserId: string,
    links: Array<{ targetId: string; targetType: TargetType }> | undefined,
    documentId: string | undefined,
    context: McpWriteContext,
  ): Promise<void> {
    for (const link of links ?? []) {
      if (link.targetType === "DOCUMENT" && link.targetId === documentId) {
        throw new ApiException(
          "DOCUMENT_LINK_TARGET_INVALID",
          "Document link target is invalid",
          HttpStatus.BAD_REQUEST,
        );
      }

      const target = await this.targets.resolve(
        actorUserId,
        link.targetType,
        link.targetId,
        {
          hideInaccessible: true,
          notFoundCode: "DOCUMENT_LINK_TARGET_INVALID",
        },
      );

      if (
        target.organizationId !== context.organizationId ||
        target.spaceId !== context.spaceId
      ) {
        throw new ApiException(
          "DOCUMENT_LINK_TARGET_INVALID",
          "Document link target is invalid",
          HttpStatus.BAD_REQUEST,
        );
      }
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
      case "pdm.document_folder.create": {
        const input = args as CreateDocumentFolderArgs;
        const folder = await this.documentFolders.create(
          principal.userId,
          input.spaceId,
          omitWriteContext(input),
          metadata,
        );

        return {
          message: "Document folder created.",
          output: folder,
        };
      }
      case "pdm.document_folder.update": {
        const input = args as UpdateDocumentFolderArgs;
        const { folderId, ...updateInput } = omitWriteContext(input);
        const folder = await this.documentFolders.update(
          principal.userId,
          folderId,
          updateInput,
          metadata,
        );

        return {
          message: "Document folder updated.",
          output: folder,
        };
      }
      case "pdm.document_folder.move": {
        const input = args as MoveDocumentFolderArgs;
        const { folderId, ...moveInput } = omitWriteContext(input);
        const folder = await this.documentFolders.move(
          principal.userId,
          folderId,
          moveInput,
          metadata,
        );

        return {
          message: "Document folder moved.",
          output: folder,
        };
      }
      case "pdm.document_folder.delete": {
        const input = args as DeleteDocumentFolderArgs;
        const { folderId } = omitWriteContext(input);
        const output = await this.documentFolders.delete(
          principal.userId,
          folderId,
          metadata,
        );

        return {
          message: "Document folder deleted.",
          output,
        };
      }
      case "pdm.document.create_from_markdown": {
        const input = args as McpCreateDocumentFromMarkdownRequest;
        const document = await this.documents.createFromMarkdown(
          principal.userId,
          input.spaceId,
          omitWriteContext(input),
          metadata,
          mcpDocumentActor(principal.clientId),
        );

        return {
          message: "Document created.",
          output: document,
        };
      }
      case "pdm.document.append_content": {
        const input = args as McpAppendDocumentContentRequest;
        const { documentId, ...appendInput } = omitWriteContext(input);
        const document = await this.documents.appendContent(
          principal.userId,
          documentId,
          appendInput,
          metadata,
          mcpDocumentActor(principal.clientId),
        );

        return {
          message: "Document content appended.",
          output: document,
        };
      }
      case "pdm.document.replace_content": {
        const input = args as McpReplaceDocumentContentRequest;
        const { documentId, ...replaceInput } = omitWriteContext(input);
        const document = await this.documents.updateContent(
          principal.userId,
          documentId,
          replaceInput,
          metadata,
          mcpDocumentActor(principal.clientId),
        );

        return {
          message: "Document content replaced.",
          output: document,
        };
      }
      case "pdm.document.update_metadata": {
        const input = args as McpUpdateDocumentMetadataRequest;
        const { documentId, ...metadataInput } = omitWriteContext(input);
        const document = await this.documents.updateMetadata(
          principal.userId,
          documentId,
          metadataInput,
          metadata,
          mcpDocumentActor(principal.clientId),
        );

        return {
          message: "Document metadata updated.",
          output: document,
        };
      }
      case "pdm.document.link_resources": {
        const input = args as McpLinkDocumentResourcesRequest;
        const { documentId, ...linkInput } = omitWriteContext(input);
        const links = await this.documents.replaceLinks(
          principal.userId,
          documentId,
          linkInput,
          metadata,
          mcpDocumentActor(principal.clientId),
        );

        return {
          message: "Document resources linked.",
          output: links,
        };
      }
      case "pdm.document.move_to_folder": {
        const input = args as MoveDocumentToFolderArgs;
        const { documentId, ...moveInput } = omitWriteContext(input);
        const document = await this.documents.moveToFolder(
          principal.userId,
          documentId,
          moveInput,
          metadata,
          mcpDocumentActor(principal.clientId),
        );

        return {
          message: "Document moved to folder.",
          output: document,
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
    targetSelectionSource: _targetSelectionSource,
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
    targetSelectionSource: args.targetSelectionSource,
  });
}

function buildBusinessMetadata(input: {
  clientId: string;
  inputSummary: Record<string, unknown>;
  organizationId: string;
  requestMetadata: RequestMetadata;
  spaceId: string;
  targetSelectionSource: Exclude<
    McpWriteTargetSelectionSource,
    "MCP_CONTEXT_FALLBACK"
  >;
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
      targetSelectionSource: input.targetSelectionSource,
      toolName: input.toolName,
      userId: input.userId,
    },
  };
}

function mcpDocumentActor(clientId: string) {
  return {
    actorType: "MCP_CLIENT" as const,
    mcpClientId: clientId,
  };
}

function dryRunSelectionResult(
  toolName: McpToolName,
  context: McpWriteContext,
  targetSelection: Extract<WriteTargetSelectionValidation, { accepted: false }>,
) {
  return McpDryRunResultSchema.parse({
    canWrite: false,
    committed: false,
    dryRun: true,
    message: targetSelection.message,
    organizationId: context.organizationId,
    reason: targetSelection.reason,
    requiresConfirmation: true,
    spaceId: context.spaceId,
    targetOrganizationName: targetSelection.organizationName,
    targetSelectionSource: targetSelection.source,
    targetSpaceName: targetSelection.spaceName,
    toolName,
    validated: ["inputSchema"],
  });
}

function summarizeInput(
  toolName: McpToolName,
  args: unknown,
): Record<string, unknown> {
  const record = isRecord(args) ? args : {};
  const textFields = [
    "appendMarkdown",
    "body",
    "contentMarkdown",
    "description",
    "title",
  ];
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
    targetId:
      record.targetId ??
      record.workItemId ??
      record.documentId ??
      record.folderId,
    targetSelectionSource: record.targetSelectionSource,
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
