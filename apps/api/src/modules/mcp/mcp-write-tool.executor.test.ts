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
import type { IntakeService } from "../intake/intake.service";
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
const WORK_ITEM_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAZ";
const WORKFLOW_VERSION_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB2";
const WORKFLOW_STATE_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB3";
const now = "2026-05-22T00:00:00.000Z";

describe("McpWriteToolExecutor", () => {
  let bugs: { create: MockFn };
  let comments: { create: MockFn };
  let executor: McpWriteToolExecutor;
  let idempotency: {
    complete: MockFn;
    reserve: MockFn;
    waitForReplay: MockFn;
  };
  let intakeItems: { create: MockFn };
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
      spaces as unknown as SpaceService,
      requirements as unknown as RequirementService,
      intakeItems as unknown as IntakeService,
      workItems as unknown as WorkItemService,
      bugs as unknown as BugService,
      comments as unknown as CommentService,
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
        committed: false,
        dryRun: true,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
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
        title: "Create task",
      },
      principal(),
      {},
    );

    expect(result).toBe(replay);
    expect(workItems.create).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});

function contract(name: McpToolName) {
  const found = mcpToolContracts.find((tool) => tool.name === name);

  if (!found) {
    throw new Error(`Missing test contract: ${name}`);
  }

  return found;
}

function principal(): McpOAuthPrincipalContext {
  return {
    accessTokenId: "access-token-id",
    authorizationId: "authorization-id",
    clientId: "test-client",
    resource: "http://localhost:3001/api/v1/mcp",
    scopes: ["mcp:write:workitem"],
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
