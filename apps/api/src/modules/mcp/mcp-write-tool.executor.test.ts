import {
  mcpToolContracts,
  type McpToolName,
  type McpToolResult,
} from "@project-delivery/shared";
import { HttpStatus } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiException } from "../../http/api-exception";
import type { McpOAuthPrincipalContext } from "../../http/request-context";
import type { BugService } from "../bug/bug.service";
import type { CommentService } from "../comment/comment.service";
import type { DocumentFolderService } from "../document/document-folder.service";
import type { DocumentService } from "../document/document.service";
import type { IntakeService } from "../intake/intake.service";
import type { OrganizationRepository } from "../organization/organization.repository";
import type { RequirementService } from "../requirement/requirement.service";
import type { SpaceService } from "../space/space.service";
import type { TagAssignmentService } from "../tag/tag-assignment.service";
import type { TargetResolverService } from "../target/target-resolver.service";
import type { WorkflowActionExecutionService } from "../workflow/workflow-action-execution.service";
import type { WorkItemService } from "../workitem/workitem.service";
import type { McpIdempotencyService } from "./mcp-idempotency.service";
import { McpWriteToolExecutor } from "./mcp-write-tool.executor";

type MockFn = ReturnType<typeof vi.fn>;

const USER_ID = "01HX0000000000000000000000";
const ORGANIZATION_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAV";
const SPACE_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAW";
const OTHER_SPACE_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAT";
const DOCUMENT_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAY";
const FOLDER_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB5";
const PARENT_FOLDER_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB6";
const WORK_ITEM_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAZ";
const WORKFLOW_VERSION_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB2";
const WORKFLOW_STATE_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB3";
const now = "2026-05-22T00:00:00.000Z";

describe("McpWriteToolExecutor", () => {
  let bugs: { create: MockFn };
  let comments: { create: MockFn };
  let documents: {
    appendContent: MockFn;
    createFromMarkdown: MockFn;
    get: MockFn;
    moveToFolder: MockFn;
    replaceLinks: MockFn;
    updateContent: MockFn;
    updateMetadata: MockFn;
  };
  let documentFolders: {
    create: MockFn;
    delete: MockFn;
    move: MockFn;
    requireFolderInSpace: MockFn;
    update: MockFn;
  };
  let executor: McpWriteToolExecutor;
  let idempotency: {
    complete: MockFn;
    reserve: MockFn;
    waitForReplay: MockFn;
  };
  let intakeItems: { create: MockFn };
  let organizations: {
    listSessionSpaceSummaries: MockFn;
    listSessionSummaries: MockFn;
  };
  let requirements: {
    createDraft: MockFn;
    update: MockFn;
    validateCreateRequest: MockFn;
  };
  let spaces: { getOverview: MockFn };
  let tagAssignments: { replace: MockFn };
  let targets: { resolve: MockFn };
  let workflowActions: { executeAction: MockFn };
  let workItems: { create: MockFn; get: MockFn; update: MockFn };

  beforeEach(() => {
    bugs = {
      create: vi.fn(),
    };
    comments = {
      create: vi.fn(),
    };
    documents = {
      appendContent: vi.fn(async () => document),
      createFromMarkdown: vi.fn(async () => document),
      get: vi.fn(async () => document),
      moveToFolder: vi.fn(async () => document),
      replaceLinks: vi.fn(async () => ({ items: [] })),
      updateContent: vi.fn(async () => ({ ...document, revision: 2 })),
      updateMetadata: vi.fn(async () => ({ ...document, title: "Updated" })),
    };
    documentFolders = {
      create: vi.fn(async () => folder),
      delete: vi.fn(async () => ({})),
      move: vi.fn(async () => folder),
      requireFolderInSpace: vi.fn(async (folderId: string) =>
        folderId === PARENT_FOLDER_ID ? parentFolder : folder,
      ),
      update: vi.fn(async () => ({ ...folder, name: "Updated" })),
    };
    idempotency = {
      complete: vi.fn(async () => undefined),
      reserve: vi.fn(async () => ({
        invocationId: "invocation-1",
        kind: "reserved",
      })),
      waitForReplay: vi.fn(),
    };
    intakeItems = {
      create: vi.fn(),
    };
    organizations = {
      listSessionSummaries: vi.fn(async () => [
        {
          code: "org",
          id: ORGANIZATION_ID,
          name: "Default Org",
          role: "OWNER",
          status: "ACTIVE",
        },
      ]),
      listSessionSpaceSummaries: vi.fn(async () => [
        {
          code: "space",
          id: SPACE_ID,
          name: "Default Space",
          organizationId: ORGANIZATION_ID,
          role: "PM",
          status: "ACTIVE",
        },
      ]),
    };
    requirements = {
      createDraft: vi.fn(),
      update: vi.fn(),
      validateCreateRequest: vi.fn(async () => undefined),
    };
    spaces = {
      getOverview: vi.fn(async () => ({ space: { id: SPACE_ID } })),
    };
    tagAssignments = {
      replace: vi.fn(),
    };
    targets = {
      resolve: vi.fn(),
    };
    workflowActions = {
      executeAction: vi.fn(),
    };
    workItems = {
      create: vi.fn(async () => workItem),
      get: vi.fn(),
      update: vi.fn(),
    };
    executor = new McpWriteToolExecutor(
      idempotency as unknown as McpIdempotencyService,
      organizations as unknown as OrganizationRepository,
      spaces as unknown as SpaceService,
      requirements as unknown as RequirementService,
      intakeItems as unknown as IntakeService,
      workItems as unknown as WorkItemService,
      bugs as unknown as BugService,
      comments as unknown as CommentService,
      documentFolders as unknown as DocumentFolderService,
      documents as unknown as DocumentService,
      tagAssignments as unknown as TagAssignmentService,
      workflowActions as unknown as WorkflowActionExecutionService,
      targets as unknown as TargetResolverService,
    );
  });

  it("validates dryRun context through idempotency without mutating business state", async () => {
    const result = await executor.execute(
      contract("pdm.work_item.create_task"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "task-dry-run-1",
        targetSelectionSource: "USER_EXPLICIT",
        dryRun: true,
        title: "Dry run task",
      },
      principal(),
      {
        requestId: "req-1",
      },
    );

    expect(result).toMatchObject({
      structuredContent: {
        canWrite: true,
        committed: false,
        dryRun: true,
        organizationId: ORGANIZATION_ID,
        requiresConfirmation: false,
        spaceId: SPACE_ID,
        targetOrganizationName: "Default Org",
        targetSelectionSource: "USER_EXPLICIT",
        targetSpaceName: "Default Space",
        toolName: "pdm.work_item.create_task",
      },
    });
    expect(spaces.getOverview).toHaveBeenCalledWith(USER_ID, SPACE_ID, {
      organizationId: ORGANIZATION_ID,
    });
    expect(idempotency.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "test-client",
        idempotencyKey: "task-dry-run-1",
        organizationId: ORGANIZATION_ID,
        requestHash: expect.any(String),
        requestId: "req-1",
        spaceId: SPACE_ID,
        toolName: "pdm.work_item.create_task",
        userId: USER_ID,
      }),
    );
    expect(idempotency.complete).toHaveBeenCalledWith({
      invocationId: "invocation-1",
      result: expect.objectContaining({
        structuredContent: expect.objectContaining({
          committed: false,
          dryRun: true,
        }),
      }),
    });
    expect(workItems.create).not.toHaveBeenCalled();
  });

  it("returns a confirmation dryRun result when the write target source is missing", async () => {
    const result = await executor.execute(
      contract("pdm.work_item.create_task"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "task-dry-run-confirm-1",
        dryRun: true,
        title: "Dry run task",
      },
      principal(),
      {
        requestId: "req-confirm",
      },
    );

    expect(result).toMatchObject({
      structuredContent: {
        canWrite: false,
        committed: false,
        dryRun: true,
        requiresConfirmation: true,
        targetOrganizationName: "Default Org",
        targetSpaceName: "Default Space",
        toolName: "pdm.work_item.create_task",
      },
    });
    expect(idempotency.reserve).not.toHaveBeenCalled();
    expect(workItems.create).not.toHaveBeenCalled();
  });

  it("rejects committed writes that use MCP context fallback targets", async () => {
    const result = await executor.execute(
      contract("pdm.work_item.create_task"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "task-fallback-1",
        targetSelectionSource: "MCP_CONTEXT_FALLBACK",
        title: "Fallback write",
      },
      principal(),
      {
        requestId: "req-fallback",
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "SPACE_CONTEXT_REQUIRED",
          details: {
            targetSelectionSource: "MCP_CONTEXT_FALLBACK",
          },
        },
      },
    });
    expect(idempotency.reserve).not.toHaveBeenCalled();
    expect(workItems.create).not.toHaveBeenCalled();
  });

  it("rejects SINGLE_WRITABLE_SPACE when more than one writable space is available", async () => {
    organizations.listSessionSpaceSummaries.mockResolvedValueOnce([
      {
        code: "space",
        id: SPACE_ID,
        name: "Default Space",
        organizationId: ORGANIZATION_ID,
        role: "PM",
        status: "ACTIVE",
      },
      {
        code: "other",
        id: OTHER_SPACE_ID,
        name: "Other Space",
        organizationId: ORGANIZATION_ID,
        role: "PM",
        status: "ACTIVE",
      },
    ]);

    const result = await executor.execute(
      contract("pdm.work_item.create_task"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "task-single-rejected-1",
        targetSelectionSource: "SINGLE_WRITABLE_SPACE",
        title: "Auto target write",
      },
      principal(),
      {
        requestId: "req-single",
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "SPACE_CONTEXT_REQUIRED",
          details: {
            writableSpaceCount: 2,
          },
        },
      },
    });
    expect(idempotency.reserve).not.toHaveBeenCalled();
    expect(workItems.create).not.toHaveBeenCalled();
  });

  it("returns MCP_IDEMPOTENCY_CONFLICT when a key is reused with different arguments", async () => {
    idempotency.reserve.mockResolvedValueOnce({
      details: {
        code: "MCP_IDEMPOTENCY_CONFLICT",
        idempotencyKey: "task-create-1",
        message: "Same idempotency key was used with different arguments.",
        toolName: "pdm.work_item.create_task",
      },
      kind: "conflict",
    });

    const result = await executor.execute(
      contract("pdm.work_item.create_task"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "task-create-1",
        targetSelectionSource: "USER_EXPLICIT",
        title: "Create task",
      },
      principal(),
      {
        requestId: "req-1",
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "MCP_IDEMPOTENCY_CONFLICT",
        },
      },
    });
    expect(workItems.create).not.toHaveBeenCalled();
  });

  it("creates tasks through WorkItemService and completes the idempotency record", async () => {
    const result = await executor.execute(
      contract("pdm.work_item.create_task"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "task-create-1",
        targetSelectionSource: "USER_EXPLICIT",
        title: "Create task",
        priority: "HIGH",
      },
      principal(),
      {
        requestId: "req-1",
        userAgent: "mcp-test",
      },
    );

    expect(workItems.create).toHaveBeenCalledWith(
      USER_ID,
      SPACE_ID,
      {
        priority: "HIGH",
        title: "Create task",
      },
      expect.objectContaining({
        metadata: expect.objectContaining({
          clientId: "test-client",
          organizationId: ORGANIZATION_ID,
          requestId: "req-1",
          resultStatus: "SUCCESS",
          source: "MCP",
          spaceId: SPACE_ID,
          targetSelectionSource: "USER_EXPLICIT",
          toolName: "pdm.work_item.create_task",
          userId: USER_ID,
        }),
        requestId: "req-1",
        userAgent: "mcp-test",
      }),
    );
    expect(idempotency.complete).toHaveBeenCalledWith({
      invocationId: "invocation-1",
      result: expect.objectContaining({
        structuredContent: expect.objectContaining({
          id: WORK_ITEM_ID,
        }),
      }),
    });
    expect(result).toMatchObject({
      structuredContent: {
        id: WORK_ITEM_ID,
        title: "Create task",
      },
    });
  });

  it("returns a permission error when a VIEWER principal reaches a write tool", async () => {
    workItems.create.mockRejectedValueOnce(
      new ApiException(
        "SPACE_ACCESS_DENIED",
        "Space access denied",
        HttpStatus.FORBIDDEN,
        { role: "VIEWER" },
      ),
    );

    const result = await executor.execute(
      contract("pdm.work_item.create_task"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "viewer-task-create-1",
        targetSelectionSource: "USER_EXPLICIT",
        title: "Viewer write attempt",
      },
      principal(),
      {
        requestId: "req-viewer",
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "SPACE_ACCESS_DENIED",
          details: {
            role: "VIEWER",
          },
        },
      },
    });
    expect(workItems.create).toHaveBeenCalledOnce();
    expect(idempotency.complete).toHaveBeenCalledWith({
      invocationId: "invocation-1",
      result: expect.objectContaining({
        isError: true,
        structuredContent: expect.objectContaining({
          error: expect.objectContaining({
            code: "SPACE_ACCESS_DENIED",
          }),
        }),
      }),
    });
  });

  it("validates requirement create before writing a draft", async () => {
    requirements.validateCreateRequest.mockRejectedValueOnce(
      new ApiException(
        "SPACE_MEMBER_NOT_FOUND",
        "Requirement owner must be an active space member",
        HttpStatus.NOT_FOUND,
      ),
    );

    const result = await executor.execute(
      contract("pdm.requirement.create"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "requirement-create-1",
        targetSelectionSource: "USER_EXPLICIT",
        title: "Create requirement",
        contentFormat: "MARKDOWN",
        contentMarkdown: "Initial requirement",
        ownerId: "01HRZ3NDEKTSV4RRFFQ69G5FB4",
      },
      principal(),
      {
        requestId: "req-requirement",
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "SPACE_MEMBER_NOT_FOUND",
        },
      },
    });
    expect(requirements.validateCreateRequest).toHaveBeenCalledWith(
      USER_ID,
      SPACE_ID,
      expect.objectContaining({
        contentFormat: "MARKDOWN",
        contentMarkdown: "Initial requirement",
        ownerId: "01HRZ3NDEKTSV4RRFFQ69G5FB4",
        title: "Create requirement",
      }),
      expect.objectContaining({
        requestId: "req-requirement",
      }),
    );
    expect(requirements.createDraft).not.toHaveBeenCalled();
    expect(requirements.update).not.toHaveBeenCalled();
  });

  it("replays completed idempotent results without invoking the business service", async () => {
    const replay: McpToolResult = {
      content: [
        {
          type: "text",
          text: "Task created.",
        },
      ],
      structuredContent: {
        id: WORK_ITEM_ID,
        replayed: true,
      },
    };
    idempotency.reserve.mockResolvedValueOnce({
      kind: "replay",
      result: replay,
    });

    const result = await executor.execute(
      contract("pdm.work_item.create_task"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "task-create-1",
        targetSelectionSource: "USER_EXPLICIT",
        title: "Create task",
      },
      principal(),
      {},
    );

    expect(result).toBe(replay);
    expect(workItems.create).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it("dry-runs document append by validating document context and baseRevision only", async () => {
    const result = await executor.execute(
      contract("pdm.document.append_content"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "document-append-dry-1",
        targetSelectionSource: "USER_EXPLICIT",
        dryRun: true,
        documentId: DOCUMENT_ID,
        baseRevision: 1,
        appendMarkdown: "New section",
      },
      principal(),
      {
        requestId: "req-document-dry",
      },
    );

    expect(result).toMatchObject({
      structuredContent: {
        committed: false,
        dryRun: true,
        toolName: "pdm.document.append_content",
      },
    });
    expect(documents.get).toHaveBeenCalledWith(USER_ID, DOCUMENT_ID);
    expect(documents.appendContent).not.toHaveBeenCalled();
  });

  it("dry-runs document link replacement by validating baseRevision", async () => {
    const result = await executor.execute(
      contract("pdm.document.link_resources"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "document-link-dry-1",
        targetSelectionSource: "USER_EXPLICIT",
        dryRun: true,
        documentId: DOCUMENT_ID,
        baseRevision: 1,
        links: [],
      },
      principal(),
      {
        requestId: "req-document-link-dry",
      },
    );

    expect(result).toMatchObject({
      structuredContent: {
        committed: false,
        dryRun: true,
        toolName: "pdm.document.link_resources",
      },
    });
    expect(documents.get).toHaveBeenCalledWith(USER_ID, DOCUMENT_ID);
    expect(documents.replaceLinks).not.toHaveBeenCalled();
  });

  it("creates documents with MCP actor metadata through DocumentService", async () => {
    const result = await executor.execute(
      contract("pdm.document.create_from_markdown"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "document-create-1",
        targetSelectionSource: "USER_EXPLICIT",
        title: "Agent handoff",
        contentMarkdown: "# Agent handoff",
      },
      principal(),
      {
        requestId: "req-document-create",
      },
    );

    expect(documents.createFromMarkdown).toHaveBeenCalledWith(
      USER_ID,
      SPACE_ID,
      {
        title: "Agent handoff",
        contentMarkdown: "# Agent handoff",
      },
      expect.objectContaining({
        metadata: expect.objectContaining({
          clientId: "test-client",
          source: "MCP",
          toolName: "pdm.document.create_from_markdown",
        }),
        requestId: "req-document-create",
      }),
      {
        actorType: "MCP_CLIENT",
        mcpClientId: "test-client",
      },
    );
    expect(result).toMatchObject({
      structuredContent: {
        id: DOCUMENT_ID,
        createdVia: "MCP_CLIENT",
      },
    });
  });

  it("creates document folders through DocumentFolderService", async () => {
    const result = await executor.execute(
      contract("pdm.document_folder.create"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "folder-create-1",
        targetSelectionSource: "USER_EXPLICIT",
        name: "Research",
        parentId: PARENT_FOLDER_ID,
      },
      principal(),
      {
        requestId: "req-folder-create",
      },
    );

    expect(documentFolders.requireFolderInSpace).toHaveBeenCalledWith(
      PARENT_FOLDER_ID,
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
      },
    );
    expect(documentFolders.create).toHaveBeenCalledWith(
      USER_ID,
      SPACE_ID,
      {
        name: "Research",
        parentId: PARENT_FOLDER_ID,
      },
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: "MCP",
          toolName: "pdm.document_folder.create",
        }),
        requestId: "req-folder-create",
      }),
    );
    expect(result).toMatchObject({
      structuredContent: {
        id: FOLDER_ID,
        name: "Research",
      },
    });
  });

  it("creates documents in folders through DocumentService", async () => {
    const result = await executor.execute(
      contract("pdm.document.create_from_markdown"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "document-create-in-folder-1",
        targetSelectionSource: "USER_EXPLICIT",
        title: "Folder handoff",
        contentMarkdown: "# Folder handoff",
        folderId: FOLDER_ID,
      },
      principal(),
      {
        requestId: "req-document-folder-create",
      },
    );

    expect(documentFolders.requireFolderInSpace).toHaveBeenCalledWith(
      FOLDER_ID,
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
      },
    );
    expect(documents.createFromMarkdown).toHaveBeenCalledWith(
      USER_ID,
      SPACE_ID,
      {
        title: "Folder handoff",
        contentMarkdown: "# Folder handoff",
        folderId: FOLDER_ID,
      },
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: "MCP",
          toolName: "pdm.document.create_from_markdown",
        }),
        requestId: "req-document-folder-create",
      }),
      {
        actorType: "MCP_CLIENT",
        mcpClientId: "test-client",
      },
    );
    expect(result).toMatchObject({
      structuredContent: {
        id: DOCUMENT_ID,
      },
    });
  });

  it("moves documents into folders after validating revision and folder context", async () => {
    const result = await executor.execute(
      contract("pdm.document.move_to_folder"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "document-move-folder-1",
        targetSelectionSource: "USER_EXPLICIT",
        documentId: DOCUMENT_ID,
        folderId: FOLDER_ID,
        baseRevision: 1,
      },
      principal(),
      {
        requestId: "req-document-move-folder",
      },
    );

    expect(documents.get).toHaveBeenCalledWith(USER_ID, DOCUMENT_ID);
    expect(documentFolders.requireFolderInSpace).toHaveBeenCalledWith(
      FOLDER_ID,
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
      },
    );
    expect(documents.moveToFolder).toHaveBeenCalledWith(
      USER_ID,
      DOCUMENT_ID,
      {
        baseRevision: 1,
        folderId: FOLDER_ID,
      },
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: "MCP",
          toolName: "pdm.document.move_to_folder",
        }),
        requestId: "req-document-move-folder",
      }),
      {
        actorType: "MCP_CLIENT",
        mcpClientId: "test-client",
      },
    );
    expect(result).toMatchObject({
      structuredContent: {
        id: DOCUMENT_ID,
      },
    });
  });

  it("rejects stale document content writes before invoking DocumentService mutators", async () => {
    const result = await executor.execute(
      contract("pdm.document.replace_content"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "document-replace-stale-1",
        targetSelectionSource: "USER_EXPLICIT",
        documentId: DOCUMENT_ID,
        baseRevision: 99,
        contentMarkdown: "# Updated",
      },
      principal(),
      {
        requestId: "req-document-stale",
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "DOCUMENT_EDIT_CONFLICT",
        },
      },
    });
    expect(documents.updateContent).not.toHaveBeenCalled();
  });

  it("rejects stale document link replacements before invoking DocumentService mutators", async () => {
    const result = await executor.execute(
      contract("pdm.document.link_resources"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "document-link-stale-1",
        targetSelectionSource: "USER_EXPLICIT",
        documentId: DOCUMENT_ID,
        baseRevision: 99,
        links: [],
      },
      principal(),
      {
        requestId: "req-document-link-stale",
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "DOCUMENT_EDIT_CONFLICT",
        },
      },
    });
    expect(documents.replaceLinks).not.toHaveBeenCalled();
  });

  it("passes MCP actor metadata when replacing document links", async () => {
    const result = await executor.execute(
      contract("pdm.document.link_resources"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "document-link-1",
        targetSelectionSource: "USER_EXPLICIT",
        documentId: DOCUMENT_ID,
        baseRevision: 1,
        links: [],
      },
      principal(),
      {
        requestId: "req-document-link",
      },
    );

    expect(documents.replaceLinks).toHaveBeenCalledWith(
      USER_ID,
      DOCUMENT_ID,
      {
        baseRevision: 1,
        links: [],
      },
      expect.objectContaining({
        metadata: expect.objectContaining({
          clientId: "test-client",
          source: "MCP",
          toolName: "pdm.document.link_resources",
        }),
        requestId: "req-document-link",
      }),
      {
        actorType: "MCP_CLIENT",
        mcpClientId: "test-client",
      },
    );
    expect(result).toMatchObject({
      structuredContent: {
        items: [],
      },
    });
  });

  it("requires requirement write scope for generic document writes to requirement documents", async () => {
    documents.get.mockResolvedValueOnce({
      ...document,
      kind: "REQUIREMENT",
    });

    const result = await executor.execute(
      contract("pdm.document.update_metadata"),
      {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        idempotencyKey: "requirement-document-metadata-1",
        targetSelectionSource: "USER_EXPLICIT",
        documentId: DOCUMENT_ID,
        tagIds: [],
      },
      principal(["mcp:write:document"]),
      {
        requestId: "req-requirement-document-metadata",
      },
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "MCP_INSUFFICIENT_SCOPE",
          details: {
            documentId: DOCUMENT_ID,
            requiredScope: "mcp:write:requirement",
          },
        },
      },
    });
    expect(documents.updateMetadata).not.toHaveBeenCalled();
  });
});

function contract(name: McpToolName) {
  const found = mcpToolContracts.find((tool) => tool.name === name);

  if (!found) {
    throw new Error(`Missing test contract: ${name}`);
  }

  return found;
}

function principal(
  scopes: string[] = ["mcp:write:workitem"],
): McpOAuthPrincipalContext {
  return {
    accessTokenId: "access-token-id",
    authorizationId: "authorization-id",
    clientId: "test-client",
    resource: "http://localhost:3001/api/v1/mcp",
    scopes,
    userId: USER_ID,
  };
}

const workItem = {
  id: WORK_ITEM_ID,
  sequence: 2,
  displayCode: "TASK-2",
  type: "TASK",
  organizationId: ORGANIZATION_ID,
  spaceId: SPACE_ID,
  title: "Create task",
  priority: "HIGH",
  reporterId: USER_ID,
  workflowVersionId: WORKFLOW_VERSION_ID,
  currentStateId: WORKFLOW_STATE_ID,
  statusCategory: "NOT_STARTED",
  lastStatusChangedAt: now,
  tags: [],
};

const document = {
  id: DOCUMENT_ID,
  organizationId: ORGANIZATION_ID,
  spaceId: SPACE_ID,
  title: "Agent handoff",
  contentMarkdown: "# Agent handoff",
  contentText: "Agent handoff",
  sourceType: "MCP_CREATED",
  status: "ACTIVE",
  revision: 1,
  createdById: USER_ID,
  createdVia: "MCP_CLIENT",
  createdMcpClientId: "test-client",
  lastEditedById: USER_ID,
  lastEditedVia: "MCP_CLIENT",
  lastEditedMcpClientId: "test-client",
  lastEditedAt: now,
  tags: [],
  links: [],
  chunks: [],
  createdAt: now,
  updatedAt: now,
};

const parentFolder = {
  id: PARENT_FOLDER_ID,
  organizationId: ORGANIZATION_ID,
  spaceId: SPACE_ID,
  name: "Knowledge",
  depth: 0,
  sortOrder: 0,
  version: 1,
  createdById: USER_ID,
  updatedById: USER_ID,
  createdAt: now,
  updatedAt: now,
};

const folder = {
  id: FOLDER_ID,
  organizationId: ORGANIZATION_ID,
  spaceId: SPACE_ID,
  parentId: PARENT_FOLDER_ID,
  name: "Research",
  depth: 1,
  sortOrder: 0,
  version: 1,
  createdById: USER_ID,
  updatedById: USER_ID,
  createdAt: now,
  updatedAt: now,
};
