// @vitest-environment jsdom

import type {
  AppSession,
  GetMyWorkbenchViewResponse,
  PageResult,
  SessionOrganizationSummary,
  SessionSpaceSummary,
  ViewCurrentStatusSummary,
  ViewWorkItemSummary,
  WorkflowActionSummary,
} from "@project-delivery/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardWorkspace } from "./dashboard-workspace";

type SessionMockValue = {
  currentOrganization: SessionOrganizationSummary | undefined;
  session: AppSession | null;
  spacesForCurrentOrganization: SessionSpaceSummary[];
  status: "authenticated" | "loading" | "unauthenticated";
};

const mocks = vi.hoisted(() => ({
  getMyWorkbenchView: vi.fn(),
  sessionValue: {
    currentOrganization: undefined,
    session: null,
    spacesForCurrentOrganization: [],
    status: "loading",
  } as SessionMockValue,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
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

vi.mock("../../i18n/routing", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

vi.mock("../../lib/view-service", () => ({
  getMyWorkbenchView: mocks.getMyWorkbenchView,
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => mocks.sessionValue,
}));

vi.mock("../onboarding/organization-onboarding", () => ({
  OrganizationOnboarding: () => createElement("section", null, "onboarding"),
}));

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const otherSpaceId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5F13";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5F14";
const bugId = "01ARZ3NDEKTSV4RRFFQ69G5F15";
const userId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5F17";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5F18";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5F19";
const actionId = "01ARZ3NDEKTSV4RRFFQ69G5F1A";
const targetStateId = "01ARZ3NDEKTSV4RRFFQ69G5F1B";

describe("DashboardWorkspace", () => {
  beforeEach(() => {
    mocks.sessionValue = createSession();
    mocks.getMyWorkbenchView.mockResolvedValue(createWorkbenchResponse());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the organization-level workbench by default", async () => {
    render(createElement(DashboardWorkspace));

    await screen.findAllByText("Prepare release");

    expect(mocks.getMyWorkbenchView).toHaveBeenCalledWith({
      organizationId,
      page: 1,
      pageSize: 20,
      spaceId: undefined,
    });
    expect(screen.getByText("Approve transition")).toBeTruthy();
    expect(screen.getByText("dashboard.sections.recentActivities.title")).toBeTruthy();
  });

  it("reloads the workbench when narrowed to a space", async () => {
    render(createElement(DashboardWorkspace));

    await screen.findAllByText("Prepare release");
    fireEvent.change(screen.getByLabelText("dashboard.filters.space"), {
      target: { value: spaceId },
    });

    await waitFor(() =>
      expect(mocks.getMyWorkbenchView).toHaveBeenLastCalledWith({
        organizationId,
        page: 1,
        pageSize: 20,
        spaceId,
      }),
    );
  });

  it("renders session loading and unauthenticated boundaries", () => {
    mocks.sessionValue = {
      currentOrganization: undefined,
      session: null,
      spacesForCurrentOrganization: [],
      status: "loading",
    };
    const { rerender } = render(createElement(DashboardWorkspace));

    expect(screen.getByText("dashboard.session.loading.title")).toBeTruthy();

    mocks.sessionValue = {
      currentOrganization: undefined,
      session: null,
      spacesForCurrentOrganization: [],
      status: "unauthenticated",
    };
    rerender(createElement(DashboardWorkspace));

    expect(screen.getByText("dashboard.session.unauthenticated.title")).toBeTruthy();
  });
});

function createSession(): SessionMockValue {
  const organization: SessionOrganizationSummary = {
    code: "ORG",
    id: organizationId,
    name: "Delivery",
    role: "OWNER",
    status: "ACTIVE",
  };
  const spaces: SessionSpaceSummary[] = [
    {
      code: "CORE",
      id: spaceId,
      name: "Core",
      organizationId,
      role: "PM",
      status: "ACTIVE",
    },
    {
      code: "OPS",
      id: otherSpaceId,
      name: "Ops",
      organizationId,
      role: "DEVELOPER",
      status: "ACTIVE",
    },
  ];

  return {
    currentOrganization: organization,
    session: {
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
      defaultOrganizationId: organizationId,
      defaultSpaceId: spaceId,
      organizations: [organization],
      spaces,
      user: {
        id: userId,
        name: "Ada Lovelace",
        preferences: {
          locale: "en-US",
          themeMode: "SYSTEM",
        },
        status: "ACTIVE",
        username: "ada",
      },
    },
    spacesForCurrentOrganization: spaces,
    status: "authenticated",
  };
}

function createWorkbenchResponse(): GetMyWorkbenchViewResponse {
  const task = createWorkItem({ id: workItemId, title: "Prepare release" });
  const bug = createWorkItem({ id: bugId, title: "Fix checkout", type: "BUG" });
  const emptySection = {
    items: page<ViewWorkItemSummary>([]),
    title: "Empty",
    total: 0,
  };

  return {
    filters: {
      organizationId,
    },
    sections: {
      actionTodos: {
        items: page([
          {
            actionTarget: {
              actionId,
              executePath: `/api/v1/work-items/${workItemId}/actions/${actionId}`,
              workItemId,
            },
            availableAction: createAction(),
            currentStatus: createStatus(),
            id: `${workItemId}:${actionId}`,
            reason: {
              code: "ASSIGNED_TO_ME",
              description: "Assigned to current user",
            },
            workItem: task,
          },
        ]),
        title: "Actions",
        total: 1,
      },
      assignedBugs: {
        items: page([bug]),
        title: "Bugs",
        total: 1,
      },
      assignedTasks: {
        items: page([task]),
        title: "Tasks",
        total: 1,
      },
      blocked: emptySection,
      dueSoon: emptySection,
      myTodos: {
        items: page([task]),
        title: "Todos",
        total: 1,
      },
      pendingConfirm: emptySection,
      recentActivities: {
        items: page([
          {
            actor: {
              id: userId,
              name: "Ada Lovelace",
              username: "ada",
            },
            createdAt: "2026-05-13T10:00:00.000Z",
            eventType: "ACTION_EXECUTED",
            id: "01ARZ3NDEKTSV4RRFFQ69G5F1C",
            organizationId,
            spaceId,
            target: {
              id: workItemId,
              title: "Prepare release",
              type: "WORK_ITEM",
            },
            title: "Action executed",
          },
        ]),
        title: "Recent",
        total: 1,
      },
    },
    stats: {
      actionTodoCount: 1,
      assignedWorkItemCount: 2,
      blockedCount: 0,
      overdueCount: 0,
      pendingConfirmCount: 0,
      pendingRegressionCount: 0,
      staleCount: 0,
    },
  };
}

function createStatus(): ViewCurrentStatusSummary {
  return {
    currentStateId: stateId,
    exceptionHints: {
      blocked: false,
      pendingConfirm: false,
      pendingRegression: false,
    },
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    stateCode: "in_progress",
    stateName: "In progress",
    statusCategory: "IN_PROGRESS",
    workflowVersionId,
  };
}

function createWorkItem(
  input: Partial<ViewWorkItemSummary> & { id: string; title: string },
): ViewWorkItemSummary {
  return {
    assigneeId: userId,
    currentStatus: createStatus(),
    dueDate: "2026-05-14T10:00:00.000Z",
    exceptionSignals: [],
    organizationId,
    priority: "HIGH",
    reporterId,
    spaceId,
    type: "TASK",
    versionId,
    ...input,
  };
}

function createAction(): WorkflowActionSummary {
  return {
    actorRelations: ["ASSIGNEE"],
    allowedSpaceRoles: ["PM"],
    code: "approve",
    formFields: [],
    fromStateId: stateId,
    id: actionId,
    name: "Approve transition",
    order: 1,
    requiresComment: false,
    toStateId: targetStateId,
  };
}

function page<TItem>(items: TItem[]): PageResult<TItem> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}
