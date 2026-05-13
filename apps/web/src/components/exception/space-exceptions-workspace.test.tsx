// @vitest-environment jsdom

import type {
  AppSession,
  GetSpaceExceptionsViewResponse,
  Space,
  SpaceMemberWithUser,
  ViewCurrentStatusSummary,
  ViewWorkItemSummary,
} from "@project-delivery/shared";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceExceptionsWorkspace } from "./space-exceptions-workspace";

const mocks = vi.hoisted(() => ({
  getSpace: vi.fn(),
  getSpaceExceptionsView: vi.fn(),
  listSpaceMembers: vi.fn(),
  updateSpace: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;

      if (values?.count !== undefined && values?.threshold !== undefined) {
        return `${fullKey}:${values.count}:${values.threshold}`;
      }

      if (values?.count !== undefined) {
        return `${fullKey}:${values.count}`;
      }

      return fullKey;
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
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../../lib/space-service", () => ({
  canManageSpace: (role: string | undefined) =>
    role === "SPACE_ADMIN" || role === "PM",
  getSpace: mocks.getSpace,
  listSpaceMembers: mocks.listSpaceMembers,
  updateSpace: mocks.updateSpace,
}));

vi.mock("../../lib/view-service", () => ({
  getSpaceExceptionsView: mocks.getSpaceExceptionsView,
}));

vi.mock("../providers/session-provider", () => ({
  useSession: mocks.useSession,
}));

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5F13";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5F14";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5F15";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5F17";

describe("SpaceExceptionsWorkspace", () => {
  beforeEach(() => {
    mocks.useSession.mockReturnValue(createSessionContext("PM"));
    mocks.getSpaceExceptionsView.mockResolvedValue(createExceptionsView());
    mocks.getSpace.mockResolvedValue(createSpace(3));
    mocks.listSpaceMembers.mockResolvedValue({
      items: [createMember(assigneeId, "Ada Lovelace", "ada")],
      page: 1,
      pageSize: 200,
      total: 1,
    });
    mocks.updateSpace.mockResolvedValue(createSpace(7));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders exception filters, counts, and detail links", async () => {
    render(<SpaceExceptionsWorkspace spaceId={spaceId} />);

    expect(await screen.findByText("Prepare release")).toBeTruthy();
    expect(screen.getByText("spaceExceptions.counts.blocked")).toBeTruthy();
    expect(screen.getAllByText("m4Views.exceptionType.blocked").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ada Lovelace (ada)").length).toBeGreaterThan(0);

    const detailLink = screen.getByRole("link", {
      name: /spaceExceptions.list.openDetail/u,
    });
    expect(detailLink.getAttribute("href")).toContain(
      `/spaces/${spaceId}/work-items?workItemId=${workItemId}`,
    );
  });

  it("updates editable stale threshold and refreshes exceptions", async () => {
    const user = userEvent.setup();
    render(<SpaceExceptionsWorkspace spaceId={spaceId} />);

    const thresholdInput = await screen.findByLabelText(
      /spaceExceptions\.threshold\.field\.label/u,
    );
    await user.click(thresholdInput);
    await user.keyboard("{Control>}a{/Control}");
    await user.keyboard("7");
    await waitFor(() => {
      expect((thresholdInput as HTMLInputElement).value).toBe("7");
    });
    await user.click(
      screen.getByRole("button", {
        name: /spaceExceptions.threshold.submit/u,
      }),
    );

    await waitFor(() => {
      expect(mocks.updateSpace).toHaveBeenCalledWith(spaceId, {
        staleThresholdDays: 7,
      });
    });
    expect(mocks.getSpaceExceptionsView).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText("spaceExceptions.threshold.saved"),
    ).toBeTruthy();
  });

  it("renders threshold as readonly for non-manager space roles", async () => {
    mocks.useSession.mockReturnValue(createSessionContext("VIEWER"));

    render(<SpaceExceptionsWorkspace spaceId={spaceId} />);

    expect(
      await screen.findByText("spaceExceptions.threshold.readonly"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /spaceExceptions.threshold.submit/u,
      }),
    ).toBeNull();
  });

  it("shows no-access state without loading APIs when the space is absent", () => {
    mocks.useSession.mockReturnValue({
      ...createSessionContext("PM"),
      currentSpace: undefined,
      session: {
        ...createSession("PM"),
        spaces: [],
      },
    });

    render(<SpaceExceptionsWorkspace spaceId={spaceId} />);

    expect(screen.getByText("spaceExceptions.states.noAccess.title")).toBeTruthy();
    expect(mocks.getSpaceExceptionsView).not.toHaveBeenCalled();
  });
});

function createSessionContext(role: AppSession["spaces"][number]["role"]) {
  const session = createSession(role);

  return {
    currentOrganization: session.organizations[0],
    currentSpace: session.spaces[0],
    createOrganization: vi.fn(),
    initializeSession: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    persistPreferences: vi.fn(),
    refreshSession: vi.fn(),
    register: vi.fn(),
    session,
    spacesForCurrentOrganization: session.spaces,
    status: "authenticated",
    switchOrganization: vi.fn(),
    switchSpace: vi.fn(),
  };
}

function createSession(role: AppSession["spaces"][number]["role"]): AppSession {
  return {
    capabilities: {
      canCreateOrganization: true,
      canCreateSpace: true,
    },
    defaultOrganizationId: organizationId,
    defaultSpaceId: spaceId,
    organizations: [
      {
        code: "ACME",
        id: organizationId,
        name: "Acme",
        role: "ADMIN",
        status: "ACTIVE",
      },
    ],
    spaces: [
      {
        code: "CORE",
        id: spaceId,
        name: "Core",
        organizationId,
        role,
        status: "ACTIVE",
      },
    ],
    user: {
      id: reporterId,
      name: "Grace Hopper",
      preferences: {
        locale: "en-US",
        themeMode: "SYSTEM",
      },
      status: "ACTIVE",
      username: "grace",
    },
  };
}

function createSpace(staleThresholdDays: number): Space {
  return {
    code: "CORE",
    id: spaceId,
    name: "Core",
    organizationId,
    settings: {
      staleThresholdDays,
    },
    status: "ACTIVE",
  };
}

function createMember(
  userId: string,
  name: string,
  username: string,
): SpaceMemberWithUser {
  return {
    id: `${userId.slice(0, -1)}9`,
    organizationId,
    role: "DEVELOPER",
    spaceId,
    status: "ACTIVE",
    user: {
      id: userId,
      name,
      status: "ACTIVE",
      username,
    },
    userId,
  };
}

function createExceptionsView(): GetSpaceExceptionsViewResponse {
  return {
    counts: [
      {
        count: 1,
        exceptionType: "blocked",
      },
    ],
    filters: {
      organizationId,
      spaceId,
    },
    items: {
      items: [
        {
          currentStatus: createStatus(),
          exceptions: createWorkItem().exceptionSignals,
          workItem: createWorkItem(),
        },
      ],
      page: 1,
      pageSize: 100,
      total: 1,
    },
  };
}

function createStatus(): ViewCurrentStatusSummary {
  return {
    currentStateId: stateId,
    exceptionHints: {
      blocked: true,
      pendingConfirm: false,
      pendingRegression: false,
    },
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    stateCode: "blocked",
    stateName: "Blocked",
    statusCategory: "WAITING",
    workflowVersionId,
  };
}

function createWorkItem(): ViewWorkItemSummary {
  return {
    assigneeId,
    currentStatus: createStatus(),
    dueDate: "2026-05-14T10:00:00.000Z",
    exceptionSignals: [
      {
        blockedReason: "Waiting for approval",
        evidenceSource: "BLOCKED_FIELD",
        reason: "Blocked by dependency",
        type: "blocked",
      },
    ],
    id: workItemId,
    organizationId,
    priority: "HIGH",
    reporterId,
    spaceId,
    title: "Prepare release",
    type: "TASK",
  };
}
