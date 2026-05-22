import { HttpStatus } from "@nestjs/common";
import type { AppSession } from "@project-delivery/shared";
import {
  mcpToolRegistry,
  type McpJsonRpcResponse,
} from "@project-delivery/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiException } from "../../http/api-exception";
import type { McpOAuthPrincipalContext } from "../../http/request-context";
import type { BugService } from "../bug/bug.service";
import type { UserRepository } from "../identity/identity.repository";
import type { IdentityUser } from "../identity/identity.types";
import type { IntakeService } from "../intake/intake.service";
import type { ObjectCodeService } from "../object-code/object-code.service";
import type { AppSessionService } from "../organization/app-session.service";
import type { RequirementService } from "../requirement/requirement.service";
import type { SpaceService } from "../space/space.service";
import type { TimelineService } from "../timeline/timeline.service";
import type { VersionService } from "../version/version.service";
import type { WorkItemService } from "../workitem/workitem.service";
import type { McpWriteToolExecutor } from "./mcp-write-tool.executor";
import { McpService, type McpHandlerResult } from "./mcp.service";

type McpJsonRpcSuccessResponse = Extract<
  McpJsonRpcResponse,
  { result: unknown }
>;
type MockFn = ReturnType<typeof vi.fn>;

const USER_ID = "01HX0000000000000000000000";
const ORGANIZATION_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAV";
const SPACE_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAW";
const VERSION_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAX";
const REQUIREMENT_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAY";
const WORK_ITEM_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAZ";
const BUG_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB0";
const WORKFLOW_VERSION_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB2";
const WORKFLOW_STATE_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB3";
const TIMELINE_EVENT_ID = "01HRZ3NDEKTSV4RRFFQ69G5FB4";
const CODEX_PROTOCOL_VERSION = "2025-06-18";
const PROTOCOL_VERSION = "2025-11-25";

describe("McpService", () => {
  let appSessions: { buildForUser: MockFn };
  let bugs: { get: MockFn };
  let intakeItems: { list: MockFn };
  let objectCodes: { lookup: MockFn };
  let requirements: { get: MockFn };
  let spaces: {
    getExceptions: MockFn;
    getMyWorkbench: MockFn;
    getOverview: MockFn;
  };
  let timelines: { list: MockFn };
  let users: { findById: MockFn };
  let versions: { getBoard: MockFn };
  let workItems: { get: MockFn };
  let writeTools: { canExecute: MockFn; execute: MockFn };
  let service: McpService;

  beforeEach(() => {
    appSessions = {
      buildForUser: vi.fn(async () => appSession),
    };
    bugs = {
      get: vi.fn(async () => bugDetail),
    };
    intakeItems = {
      list: vi.fn(async () => intakeList),
    };
    objectCodes = {
      lookup: vi.fn(async () => objectCodeLookup),
    };
    requirements = {
      get: vi.fn(async () => requirement),
    };
    spaces = {
      getExceptions: vi.fn(async () => spaceExceptions),
      getMyWorkbench: vi.fn(async () => workbenchView),
      getOverview: vi.fn(async () => spaceOverview),
    };
    timelines = {
      list: vi.fn(async () => timelinePage),
    };
    users = {
      findById: vi.fn(async () => identityUser),
    };
    versions = {
      getBoard: vi.fn(async () => versionBoard),
    };
    workItems = {
      get: vi.fn(async () => workItemDetail),
    };
    writeTools = {
      canExecute: vi.fn(() => false),
      execute: vi.fn(async () => ({
        content: [
          {
            type: "text",
            text: "Write tool executed.",
          },
        ],
        structuredContent: {
          id: REQUIREMENT_ID,
        },
      })),
    };
    service = new McpService(
      appSessions as unknown as AppSessionService,
      users as unknown as UserRepository,
      objectCodes as unknown as ObjectCodeService,
      spaces as unknown as SpaceService,
      versions as unknown as VersionService,
      requirements as unknown as RequirementService,
      intakeItems as unknown as IntakeService,
      workItems as unknown as WorkItemService,
      bugs as unknown as BugService,
      timelines as unknown as TimelineService,
      writeTools as unknown as McpWriteToolExecutor,
    );
  });

  it("handles initialize without requiring the protocol version header", async () => {
    const body = expectJsonRpc(
      await service.handle(
        {
          jsonrpc: "2.0",
          id: "init-1",
          method: "initialize",
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
              name: "test-client",
              version: "1.0.0",
            },
          },
        },
        principal(["mcp:read"]),
        undefined,
      ),
    );

    expect(body).toMatchObject({
      id: "init-1",
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    });
  });

  it("accepts Codex initialize params with the 2025-06-18 protocol and title", async () => {
    const body = expectJsonRpc(
      await service.handle(
        {
          jsonrpc: "2.0",
          id: "init-codex",
          method: "initialize",
          params: {
            protocolVersion: CODEX_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
              name: "codex",
              title: "Codex",
              version: "1.0.0",
            },
          },
        },
        principal(["mcp:read"]),
        undefined,
      ),
    );

    expect(body).toMatchObject({
      id: "init-codex",
      result: {
        protocolVersion: CODEX_PROTOCOL_VERSION,
      },
    });
  });

  it("accepts tools/list without the protocol version header", async () => {
    const body = expectJsonRpc(
      await service.handle(
        {
          jsonrpc: "2.0",
          id: "list-no-header",
          method: "tools/list",
        },
        principal(["mcp:read"]),
        undefined,
      ),
    );

    expect(body).toMatchObject({
      id: "list-no-header",
      result: {
        tools: mcpToolRegistry,
      },
    });
  });

  it("rejects an unsupported protocol version header", async () => {
    const result = await service.handle(
      {
        jsonrpc: "2.0",
        id: "list-unsupported-protocol",
        method: "tools/list",
      },
      principal(["mcp:read"]),
      "2099-01-01",
    );

    expect(result).toMatchObject({
      kind: "http-error",
      status: 400,
      body: {
        code: "BAD_REQUEST",
        message: "Unsupported MCP protocol version.",
      },
    });
  });

  it("accepts the initialized notification without the protocol version header", async () => {
    const result = await service.handle(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      principal(["mcp:read"]),
      undefined,
    );

    expect(result).toMatchObject({
      kind: "empty",
      status: 202,
    });
  });

  it("returns the shared tool registry for tools/list", async () => {
    const body = expectJsonRpc(
      await service.handle(
        {
          jsonrpc: "2.0",
          id: "list-1",
          method: "tools/list",
        },
        principal(["mcp:read"]),
        PROTOCOL_VERSION,
      ),
    );

    expect(body).toMatchObject({
      id: "list-1",
      result: {
        tools: mcpToolRegistry,
      },
    });
  });

  it("accepts the negotiated 2025-06-18 protocol header after initialize", async () => {
    const body = expectJsonRpc(
      await service.handle(
        {
          jsonrpc: "2.0",
          id: "list-codex",
          method: "tools/list",
        },
        principal(["mcp:read"]),
        CODEX_PROTOCOL_VERSION,
      ),
    );

    expect(body).toMatchObject({
      id: "list-codex",
      result: {
        tools: mcpToolRegistry,
      },
    });
  });

  it("executes crm.context.get as the first smoke tool", async () => {
    const body = expectJsonRpc(
      await service.handle(
        {
          jsonrpc: "2.0",
          id: "call-1",
          method: "tools/call",
          params: {
            name: "crm.context.get",
            arguments: {},
          },
        },
        principal(["mcp:read"]),
        PROTOCOL_VERSION,
      ),
    );
    const result = body.result as {
      content: Array<{ text: string; type: string }>;
      structuredContent: AppSession;
    };

    expect(appSessions.buildForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: USER_ID,
        username: "agent",
      }),
    );
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "CRM context returned.",
    });
    expect(result.structuredContent.user.id).toBe(USER_ID);
  });

  it("executes first-phase read tools through existing business services", async () => {
    const lookup = expectJsonRpc(
      await callTool(service, "crm.object.lookup_code", {
        organizationId: ORGANIZATION_ID,
        code: "REQ-1",
      }),
    );
    expect(lookup.result).toMatchObject({
      structuredContent: {
        id: REQUIREMENT_ID,
        title: "Requirement",
      },
    });
    expect(objectCodes.lookup).toHaveBeenCalledWith(USER_ID, {
      organizationId: ORGANIZATION_ID,
      code: "REQ-1",
    });

    await callTool(service, "crm.workbench.get", {
      organizationId: ORGANIZATION_ID,
      page: 1,
      pageSize: 20,
    });
    expect(spaces.getMyWorkbench).toHaveBeenCalledWith(USER_ID, {
      organizationId: ORGANIZATION_ID,
      page: 1,
      pageSize: 20,
    });

    await callTool(service, "crm.space.overview_get", {
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });
    expect(spaces.getOverview).toHaveBeenCalledWith(USER_ID, SPACE_ID, {
      organizationId: ORGANIZATION_ID,
    });

    await callTool(service, "crm.version.board_get", {
      versionId: VERSION_ID,
      page: 1,
      pageSize: 20,
    });
    expect(versions.getBoard).toHaveBeenCalledWith(USER_ID, VERSION_ID, {
      page: 1,
      pageSize: 20,
    });

    await callTool(service, "crm.exceptions.list", {
      spaceId: SPACE_ID,
      page: 1,
      pageSize: 20,
    });
    expect(spaces.getExceptions).toHaveBeenCalledWith(USER_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    await callTool(service, "crm.requirement.get", {
      requirementId: REQUIREMENT_ID,
    });
    expect(requirements.get).toHaveBeenCalledWith(USER_ID, REQUIREMENT_ID);

    await callTool(service, "crm.intake.list", {
      spaceId: SPACE_ID,
      page: 1,
      pageSize: 20,
    });
    expect(intakeItems.list).toHaveBeenCalledWith(USER_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
      tagMatch: "ANY",
    });

    await callTool(service, "crm.work_item.get", {
      workItemId: WORK_ITEM_ID,
    });
    expect(workItems.get).toHaveBeenCalledWith(USER_ID, WORK_ITEM_ID);

    await callTool(service, "crm.bug.get", {
      bugId: BUG_ID,
    });
    expect(bugs.get).toHaveBeenCalledWith(USER_ID, BUG_ID);

    await callTool(service, "crm.timeline.list", {
      targetType: "WORK_ITEM",
      targetId: WORK_ITEM_ID,
      page: 1,
      pageSize: 20,
    });
    expect(timelines.list).toHaveBeenCalledWith(USER_ID, {
      targetType: "WORK_ITEM",
      targetId: WORK_ITEM_ID,
      page: 1,
      pageSize: 20,
    });
  });

  it("returns business failures as tool errors without leaking lookup details", async () => {
    objectCodes.lookup.mockRejectedValueOnce(
      new ApiException(
        "OBJECT_CODE_NOT_FOUND",
        "Object code not found",
        HttpStatus.NOT_FOUND,
      ),
    );

    const body = expectJsonRpc(
      await callTool(service, "crm.object.lookup_code", {
        organizationId: ORGANIZATION_ID,
        code: "REQ-404",
      }),
    );

    expect(body).not.toHaveProperty("error");
    expect(body.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "OBJECT_CODE_NOT_FOUND",
          message: "Object code not found",
        },
      },
    });
    expect(JSON.stringify(body.result)).not.toContain("Requirement");
    expect(JSON.stringify(body.result)).not.toContain(SPACE_ID);
  });

  it("returns tool error results for unknown and invalid tools", async () => {
    const unknown = expectJsonRpc(
      await service.handle(
        {
          jsonrpc: "2.0",
          id: "call-missing",
          method: "tools/call",
          params: {
            name: "crm.missing",
            arguments: {},
          },
        },
        principal(["mcp:read"]),
        PROTOCOL_VERSION,
      ),
    );
    expect(unknown.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "MCP_TOOL_NOT_FOUND",
        },
      },
    });

    const invalid = expectJsonRpc(
      await service.handle(
        {
          jsonrpc: "2.0",
          id: "call-invalid",
          method: "tools/call",
          params: {
            name: "crm.context.get",
            arguments: {
              unexpected: true,
            },
          },
        },
        principal(["mcp:read"]),
        PROTOCOL_VERSION,
      ),
    );
    expect(invalid.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "MCP_TOOL_ARGUMENT_INVALID",
        },
      },
    });

  });

  it("dispatches first-phase write tools to the write executor", async () => {
    writeTools.canExecute.mockImplementation(
      (name: string) => name === "crm.requirement.create",
    );

    const body = expectJsonRpc(
      await callTool(
        service,
        "crm.requirement.create",
        {
          organizationId: ORGANIZATION_ID,
          spaceId: SPACE_ID,
          idempotencyKey: "requirement-create-1",
          title: "Create requirement",
          contentFormat: "MARKDOWN",
          contentMarkdown: "# Requirement",
        },
        ["mcp:write:requirement"],
      ),
    );

    expect(writeTools.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "crm.requirement.create",
      }),
      expect.objectContaining({
        title: "Create requirement",
      }),
      expect.objectContaining({
        clientId: "test-client",
        userId: USER_ID,
      }),
      {},
    );
    expect(body.result).toMatchObject({
      structuredContent: {
        id: REQUIREMENT_ID,
      },
    });
  });

  it("returns an auth error marker when a tool scope is missing", async () => {
    const result = await service.handle(
      {
        jsonrpc: "2.0",
        id: "call-write",
        method: "tools/call",
        params: {
          name: "crm.requirement.create",
          arguments: {},
        },
      },
      principal(["mcp:read"]),
      PROTOCOL_VERSION,
    );

    expect(result).toMatchObject({
      kind: "auth-error",
      status: 403,
      body: {
        code: "MCP_INSUFFICIENT_SCOPE",
      },
      challenge: {
        error: "insufficient_scope",
        scope: "mcp:write:requirement",
      },
    });
  });
});

function expectJsonRpc(result: McpHandlerResult): McpJsonRpcSuccessResponse {
  expect(result.kind).toBe("json-rpc");

  if (result.kind !== "json-rpc") {
    throw new Error(`Expected JSON-RPC result, received ${result.kind}`);
  }

  if (!("result" in result.body)) {
    throw new Error("Expected JSON-RPC success response.");
  }

  return result.body;
}

async function callTool(
  service: McpService,
  name: string,
  args: Record<string, unknown>,
  scopes: string[] = ["mcp:read"],
): Promise<McpHandlerResult> {
  return service.handle(
    {
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
    principal(scopes),
    PROTOCOL_VERSION,
  );
}

function principal(scopes: string[]): McpOAuthPrincipalContext {
  return {
    accessTokenId: "access-token-id",
    authorizationId: "authorization-id",
    clientId: "test-client",
    resource: "http://localhost:3001/api/v1/mcp",
    scopes,
    userId: USER_ID,
  };
}

const identityUser: IdentityUser = {
  id: USER_ID,
  username: "agent",
  passwordHash: "hash",
  name: "Agent User",
  status: "ACTIVE",
  locale: "zh-CN",
  themeMode: "SYSTEM",
};

const appSession: AppSession = {
  user: {
    id: USER_ID,
    username: "agent",
    name: "Agent User",
    status: "ACTIVE",
    preferences: {
      locale: "zh-CN",
      themeMode: "SYSTEM",
    },
  },
  organizations: [],
  spaces: [],
  capabilities: {
    canCreateOrganization: true,
    canCreateSpace: false,
  },
};

const now = "2026-05-22T00:00:00.000Z";

function page<T>(items: T[] = []) {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function workItemSection(title: string) {
  return {
    title,
    total: 0,
    items: page(),
  };
}

const objectCodeLookup = {
  id: REQUIREMENT_ID,
  type: "REQUIREMENT",
  organizationId: ORGANIZATION_ID,
  sequence: 1,
  displayCode: "REQ-1",
  spaceId: SPACE_ID,
  title: "Requirement",
};

const workbenchView = {
  filters: {
    organizationId: ORGANIZATION_ID,
  },
  stats: {
    assignedWorkItemCount: 0,
    actionTodoCount: 0,
    overdueCount: 0,
    blockedCount: 0,
    pendingConfirmCount: 0,
    pendingRegressionCount: 0,
    staleCount: 0,
  },
  sections: {
    myTodos: workItemSection("My todos"),
    assignedTasks: workItemSection("Assigned tasks"),
    assignedBugs: workItemSection("Assigned bugs"),
    actionTodos: {
      title: "Action todos",
      total: 0,
      items: page(),
    },
    pendingConfirm: workItemSection("Pending confirm"),
    dueSoon: workItemSection("Due soon"),
    blocked: workItemSection("Blocked"),
    recentActivities: {
      title: "Recent activities",
      total: 0,
      items: page(),
    },
  },
};

const space = {
  id: SPACE_ID,
  organizationId: ORGANIZATION_ID,
  name: "Delivery",
  code: "delivery",
  status: "ACTIVE",
  settings: {
    staleThresholdDays: 3,
  },
};

const spaceOverview = {
  space,
  stats: {
    versionCount: 0,
    requirementCount: 0,
    taskCount: 0,
    completedTaskCount: 0,
    bugCount: 0,
    openBugCount: 0,
    blockedCount: 0,
    overdueCount: 0,
  },
  defaultWorkflows: [],
  filters: {
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
  },
};

const versionBoard = {
  filters: {
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    versionId: VERSION_ID,
  },
  columns: [],
};

const spaceExceptions = {
  filters: {
    spaceId: SPACE_ID,
  },
  counts: [],
  items: page(),
};

const requirement = {
  id: REQUIREMENT_ID,
  organizationId: ORGANIZATION_ID,
  spaceId: SPACE_ID,
  sequence: 1,
  displayCode: "REQ-1",
  title: "Requirement",
  status: "CONFIRMED",
  priority: "HIGH",
  contentFormat: "MARKDOWN",
  contentMarkdown: "# Requirement",
  tags: [],
  relatedWorkItems: {
    taskCount: 0,
    bugCount: 0,
    tasks: [],
    bugs: [],
  },
  createdAt: now,
  updatedAt: now,
};

const intakeList = {
  ...page(),
  statusCounts: [],
};

const permissionSnapshot = {
  canEdit: true,
  canComment: true,
  canUploadAttachment: true,
  availableActions: [],
};

const workItemDetail = {
  id: WORK_ITEM_ID,
  sequence: 2,
  displayCode: "TASK-2",
  type: "TASK",
  organizationId: ORGANIZATION_ID,
  spaceId: SPACE_ID,
  title: "Implement task",
  priority: "MEDIUM",
  reporterId: USER_ID,
  workflowVersionId: WORKFLOW_VERSION_ID,
  currentStateId: WORKFLOW_STATE_ID,
  statusCategory: "IN_PROGRESS",
  lastStatusChangedAt: now,
  tags: [],
  permissions: permissionSnapshot,
};

const bugDetail = {
  ...workItemDetail,
  id: BUG_ID,
  sequence: 3,
  displayCode: "BUG-3",
  type: "BUG",
  title: "Fix bug",
  bugDetail: {
    workItemId: BUG_ID,
    severity: "MAJOR",
  },
};

const timelinePage = {
  ...page([
    {
      id: TIMELINE_EVENT_ID,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      target: {
        type: "WORK_ITEM",
        id: WORK_ITEM_ID,
        sequence: 2,
        displayCode: "TASK-2",
        title: "Implement task",
      },
      eventType: "CREATED",
      actor: {
        id: USER_ID,
        username: "agent",
        name: "Agent User",
      },
      title: "Created task",
      createdAt: now,
    },
  ]),
};
