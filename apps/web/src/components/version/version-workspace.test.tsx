// @vitest-environment jsdom

import type {
  AppSession,
  GetVersionBoardViewResponse,
  PageResult,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  SpaceRole,
  Version,
  ViewWorkItemSummary,
} from "@project-delivery/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VersionWorkspace } from "./version-workspace";

type SessionMockValue = {
  currentSpace: SessionSpaceSummary | undefined;
  session: AppSession | null;
  status: "authenticated" | "loading" | "unauthenticated";
};

const mocks = vi.hoisted(() => ({
  createVersion: vi.fn(),
  getVersionBoardView: vi.fn(),
  listVersionAssignableMembers: vi.fn(),
  listVersions: vi.fn(),
  sessionValue: {
    currentSpace: undefined,
    session: null,
    status: "loading",
  } as SessionMockValue,
  updateVersion: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const renderedValues = values
        ? `:${Object.values(values).join(":")}`
        : "";

      return `${namespace ? `${namespace}.` : ""}${key}${renderedValues}`;
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

vi.mock("../providers/session-provider", () => ({
  useSession: () => mocks.sessionValue,
}));

vi.mock("../../lib/version-service", () => ({
  createVersion: mocks.createVersion,
  listVersionAssignableMembers: mocks.listVersionAssignableMembers,
  listVersions: mocks.listVersions,
  updateVersion: mocks.updateVersion,
}));

vi.mock("../../lib/view-service", () => ({
  getVersionBoardView: mocks.getVersionBoardView,
}));

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5F13";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5F14";
const taskId = "01ARZ3NDEKTSV4RRFFQ69G5F15";
const bugId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5F17";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5F18";

describe("VersionWorkspace", () => {
  beforeEach(() => {
    mocks.sessionValue = createSession("PM");
    mocks.listVersions.mockResolvedValue(page([createVersionFixture()]));
    mocks.listVersionAssignableMembers.mockResolvedValue(
      page([createMemberFixture(assigneeId), createMemberFixture(reporterId)]),
    );
    mocks.getVersionBoardView.mockResolvedValue(createBoardResponse());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads a version board scoped by selected version and filter changes", async () => {
    render(createElement(VersionWorkspace, { spaceId }));

    await screen.findByText("Prepare release");

    expect(mocks.getVersionBoardView).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 100,
        spaceId,
        versionId,
      }),
    );

    fireEvent.change(screen.getByLabelText("versions.board.filters.assignee"), {
      target: { value: assigneeId },
    });

    await waitFor(() =>
      expect(mocks.getVersionBoardView).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assigneeId,
          spaceId,
          versionId,
        }),
      ),
    );
  });

  it("links board cards to task and bug detail entry points", async () => {
    render(createElement(VersionWorkspace, { spaceId }));

    const taskLink = await screen.findByLabelText(
      "versions.board.card.open:Prepare release",
    );
    const bugLink = await screen.findByLabelText(
      "versions.board.card.open:Crash checkout",
    );

    expect(taskLink.getAttribute("href")).toBe(
      `/spaces/${spaceId}/work-items?versionId=${versionId}&workItemId=${taskId}`,
    );
    expect(bugLink.getAttribute("href")).toBe(
      `/spaces/${spaceId}/bugs?versionId=${versionId}&bugId=${bugId}`,
    );
  });

  it("stops at no-access state without loading APIs when the space is absent", () => {
    const session = createSession("PM").session;
    if (!session) {
      throw new Error("Expected authenticated session fixture.");
    }

    mocks.sessionValue = {
      currentSpace: undefined,
      session: {
        ...session,
        spaces: [],
      },
      status: "authenticated",
    };

    render(createElement(VersionWorkspace, { spaceId }));

    expect(screen.getByText("versions.states.noAccess.title")).toBeTruthy();
    expect(mocks.listVersions).not.toHaveBeenCalled();
    expect(mocks.getVersionBoardView).not.toHaveBeenCalled();
  });

  it("renders version forms as readonly for non-manager roles", async () => {
    mocks.sessionValue = createSession("VIEWER");

    render(createElement(VersionWorkspace, { spaceId }));

    await screen.findByText("Version 1");

    expect(
      (screen.getAllByLabelText("versions.form.name")[0] as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getAllByLabelText("versions.form.status")[0] as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
        name: /versions.create.submit/u,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getAllByText("versions.form.readonly").length).toBeGreaterThan(0);
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
    spaces: [
      {
        code: "SPACE",
        id: spaceId,
        name: "Space",
        organizationId,
        role,
        status: "ACTIVE",
      },
    ],
    user: {
      id: reporterId,
      name: "Reporter",
      preferences: {
        locale: "en-US",
        themeMode: "LIGHT",
      },
      status: "ACTIVE",
      username: "reporter",
    },
  };

  return {
    currentSpace: session.spaces[0],
    session,
    status: "authenticated",
  };
}

function createVersionFixture(): Version {
  return {
    description: "Version",
    id: versionId,
    name: "Version 1",
    organizationId,
    ownerId: assigneeId,
    spaceId,
    stats: {
      blockedCount: 1,
      bugCount: 1,
      requirementCount: 1,
      taskCount: 1,
    },
    status: "IN_PROGRESS",
  };
}

function createMemberFixture(userId: string): SpaceMemberWithUser {
  return {
    id: userId,
    organizationId,
    role: "MEMBER",
    spaceId,
    status: "ACTIVE",
    user: {
      id: userId,
      name: `Member ${userId.slice(-2)}`,
      status: "ACTIVE",
      username: `member-${userId.slice(-2)}`,
    },
    userId,
  };
}

function createBoardResponse(): GetVersionBoardViewResponse {
  return {
    columns: [
      {
        statusCategory: "IN_PROGRESS",
        title: "In progress",
        total: 1,
      },
      {
        statusCategory: "WAITING",
        title: "Waiting",
        total: 1,
      },
    ],
    filters: {
      organizationId,
      spaceId,
      versionId,
    },
    items: page([
      createWorkItem({ id: taskId, statusCategory: "IN_PROGRESS" }),
      createWorkItem({
        id: bugId,
        statusCategory: "WAITING",
        title: "Crash checkout",
        type: "BUG",
      }),
    ]),
  };
}

function createWorkItem(
  overrides: Partial<ViewWorkItemSummary> & {
    statusCategory?: ViewWorkItemSummary["currentStatus"]["statusCategory"];
  } = {},
): ViewWorkItemSummary {
  const statusCategory = overrides.statusCategory ?? "IN_PROGRESS";
  const { statusCategory: _statusCategory, ...itemOverrides } = overrides;

  return {
    assigneeId,
    currentStatus: {
      currentStateId: stateId,
      exceptionHints: {
        blocked: false,
        pendingConfirm: false,
        pendingRegression: false,
      },
      lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
      stateCode: statusCategory.toLowerCase(),
      stateName: statusCategory,
      statusCategory,
      workflowVersionId,
    },
    dueDate: "2026-05-14T10:00:00.000Z",
    exceptionSignals: [],
    id: taskId,
    organizationId,
    priority: "HIGH",
    reporterId,
    spaceId,
    title: "Prepare release",
    type: "TASK",
    versionId,
    ...itemOverrides,
  };
}
