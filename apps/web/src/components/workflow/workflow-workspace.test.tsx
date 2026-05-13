// @vitest-environment jsdom

import type {
  AppSession,
  PageResult,
  SessionSpaceSummary,
  SpaceRole,
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowVersion,
} from "@project-delivery/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../lib/api-client";
import { WorkflowWorkspace } from "./workflow-workspace";

type SessionMockValue = {
  currentSpace: SessionSpaceSummary | undefined;
  session: AppSession | null;
  status: "authenticated" | "loading" | "unauthenticated";
};

const mocks = vi.hoisted(() => ({
  createActionFormField: vi.fn(),
  createWorkflow: vi.fn(),
  createWorkflowAction: vi.fn(),
  createWorkflowBinding: vi.fn(),
  createWorkflowState: vi.fn(),
  createWorkflowVersion: vi.fn(),
  deleteActionFormField: vi.fn(),
  deleteWorkflowAction: vi.fn(),
  deleteWorkflowState: vi.fn(),
  getWorkflowVersion: vi.fn(),
  listWorkflowBindings: vi.fn(),
  listWorkflows: vi.fn(),
  publishWorkflowVersion: vi.fn(),
  sessionValue: {
    currentSpace: undefined,
    session: null,
    status: "loading",
  } as SessionMockValue,
  updateActionFormField: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowAction: vi.fn(),
  updateWorkflowBinding: vi.fn(),
  updateWorkflowState: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const text = namespace ? `${namespace}.${key}` : key;
      if (!values) {
        return text;
      }

      return Object.entries(values).reduce(
        (result, [name, value]) => result.replace(`{${name}}`, String(value)),
        text,
      );
    };
  },
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => mocks.sessionValue,
}));

vi.mock("../../lib/workflow-service", () => ({
  createActionFormField: mocks.createActionFormField,
  createWorkflow: mocks.createWorkflow,
  createWorkflowAction: mocks.createWorkflowAction,
  createWorkflowBinding: mocks.createWorkflowBinding,
  createWorkflowState: mocks.createWorkflowState,
  createWorkflowVersion: mocks.createWorkflowVersion,
  deleteActionFormField: mocks.deleteActionFormField,
  deleteWorkflowAction: mocks.deleteWorkflowAction,
  deleteWorkflowState: mocks.deleteWorkflowState,
  getWorkflowVersion: mocks.getWorkflowVersion,
  listWorkflowBindings: mocks.listWorkflowBindings,
  listWorkflows: mocks.listWorkflows,
  publishWorkflowVersion: mocks.publishWorkflowVersion,
  updateActionFormField: mocks.updateActionFormField,
  updateWorkflow: mocks.updateWorkflow,
  updateWorkflowAction: mocks.updateWorkflowAction,
  updateWorkflowBinding: mocks.updateWorkflowBinding,
  updateWorkflowState: mocks.updateWorkflowState,
}));

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const workflowId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5F13";
const draftWorkflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5F14";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5F15";
const doneStateId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const actionId = "01ARZ3NDEKTSV4RRFFQ69G5F17";
const bindingId = "01ARZ3NDEKTSV4RRFFQ69G5F18";

describe("WorkflowWorkspace", () => {
  beforeEach(() => {
    mocks.sessionValue = createSession("PM");
    mocks.listWorkflows.mockResolvedValue(page([createWorkflowFixture()]));
    mocks.listWorkflowBindings.mockResolvedValue(page([createBindingFixture()]));
    mocks.getWorkflowVersion.mockResolvedValue(createVersionFixture());
    mocks.createWorkflowVersion.mockResolvedValue(
      createVersionFixture({
        id: draftWorkflowVersionId,
        status: "DRAFT",
        version: 2,
      }),
    );
    mocks.publishWorkflowVersion.mockResolvedValue(
      createVersionFixture({ status: "PUBLISHED" }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads workflow list, bindings, and the bound published version", async () => {
    render(createElement(WorkflowWorkspace, { spaceId }));

    await screen.findByText("Bug workflow");

    expect(mocks.listWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 100,
        spaceId,
      }),
    );
    expect(mocks.listWorkflowBindings).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 100,
        spaceId,
      }),
    );
    expect(mocks.getWorkflowVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowVersionId,
      }),
    );
    await screen.findByText("workflow.version.publishedReadonly");
  });

  it("copies a published version before editing", async () => {
    render(createElement(WorkflowWorkspace, { spaceId }));

    await screen.findByText("workflow.version.publishedReadonly");
    fireEvent.click(screen.getByText("workflow.version.copyDraft"));

    await waitFor(() =>
      expect(mocks.createWorkflowVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId,
        }),
        {
          sourceWorkflowVersionId: workflowVersionId,
        },
      ),
    );
    await screen.findByText("workflow.notices.draftCopied");
  });

  it("shows backend publish validation issues", async () => {
    mocks.getWorkflowVersion.mockResolvedValue(
      createVersionFixture({ status: "DRAFT" }),
    );
    mocks.publishWorkflowVersion.mockRejectedValue(
      new ApiClientError(
        {
          code: "WORKFLOW_PUBLISH_VALIDATION_FAILED",
          details: {
            issues: [
              {
                code: "END_STATE_REQUIRED",
                message: "Workflow version must have at least one end state",
              },
            ],
          },
          message: "Workflow publish validation failed",
          requestId: "request-1",
        },
        new Response(null, {
          status: 400,
          statusText: "Bad Request",
        }),
      ),
    );

    render(createElement(WorkflowWorkspace, { spaceId }));

    await screen.findByText("workflow.version.publish");
    fireEvent.click(screen.getByText("workflow.version.publish"));

    await screen.findByText("END_STATE_REQUIRED");
    expect(
      screen.getByText("Workflow version must have at least one end state"),
    ).toBeTruthy();
  });
});

function page<T>(items: T[]): PageResult<T> {
  return {
    items,
    page: 1,
    pageSize: 100,
    total: items.length,
  };
}

function createSession(role: SpaceRole): SessionMockValue {
  const currentSpace: SessionSpaceSummary = {
    code: "SPACE",
    id: spaceId,
    name: "Space",
    organizationId,
    role,
    status: "ACTIVE",
  };
  const session: AppSession = {
    capabilities: {
      canCreateOrganization: true,
      canCreateSpace: true,
    },
    defaultOrganizationId: organizationId,
    defaultSpaceId: spaceId,
    organizations: [
      {
        code: "ORG",
        id: organizationId,
        name: "Org",
        role: "MEMBER",
        status: "ACTIVE",
      },
    ],
    spaces: [currentSpace],
    user: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5F19",
      name: "Project manager",
      preferences: {
        locale: "en-US",
        themeMode: "SYSTEM",
      },
      status: "ACTIVE",
      username: "pm",
    },
  };

  return {
    currentSpace,
    session,
    status: "authenticated",
  };
}

function createWorkflowFixture(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    code: "BUG_FLOW",
    description: "Bug lifecycle",
    id: workflowId,
    name: "Bug workflow",
    organizationId,
    spaceId,
    status: "ACTIVE",
    ...overrides,
  };
}

function createVersionFixture(
  overrides: Partial<WorkflowVersion> = {},
): WorkflowVersion {
  return {
    actions: [
      {
        actorRelations: ["ASSIGNEE"],
        allowedSpaceRoles: ["DEVELOPER"],
        code: "START",
        formFields: [],
        fromStateId: stateId,
        id: actionId,
        name: "Start work",
        order: 0,
        requiresComment: false,
        toStateId: doneStateId,
      },
    ],
    id: workflowVersionId,
    states: [
      {
        category: "NOT_STARTED",
        code: "OPEN",
        id: stateId,
        isEnd: false,
        isStart: true,
        name: "Open",
        order: 0,
        workflowVersionId,
      },
      {
        category: "DONE",
        code: "DONE",
        id: doneStateId,
        isEnd: true,
        isStart: false,
        name: "Done",
        order: 1,
        workflowVersionId,
      },
    ],
    status: "PUBLISHED",
    version: 1,
    workflowId,
    ...overrides,
  };
}

function createBindingFixture(
  overrides: Partial<WorkflowBinding> = {},
): WorkflowBinding {
  return {
    id: bindingId,
    isDefault: true,
    organizationId,
    spaceId,
    workflowId,
    workflowVersionId,
    workItemType: "BUG",
    ...overrides,
  };
}
