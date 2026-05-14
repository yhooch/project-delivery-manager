import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<string, (key: string) => string>(),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string) => (namespace ? `${namespace}.${k}` : k);
      translatorCache.set(key, fn);
    }
    return fn;
  },
  useLocale: () => "zh-CN",
}));

vi.mock("../../i18n/routing", () => ({
  routing: { defaultLocale: "zh-CN", locales: ["zh-CN", "en-US"] },
  Link: ({ children }: { children: React.ReactNode }) => children,
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      user: { id: "USR_01", name: "Test User" },
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { getMyWorkbenchViewMock } = vi.hoisted(() => ({
  getMyWorkbenchViewMock: vi.fn(),
}));
vi.mock("../../lib/view-service", () => ({
  getMyWorkbenchView: getMyWorkbenchViewMock,
}));

// Lookups: stubbed inert so the component renders without hitting member/version
// services. The component falls back to assigneeId / version-id tails when no
// lookup hits, which is the legacy behaviour these tests already exercise.
vi.mock("../../lib/v2/lookups", () => ({
  useSpaceMembers: () => ({
    members: [],
    loading: false,
    error: null,
    getMember: () => undefined,
  }),
  useVersions: () => ({
    versions: [],
    loading: false,
    error: null,
    getVersion: () => undefined,
  }),
}));

// Mock the task-detail-sheet so it doesn't render full Radix tree.
vi.mock("../work-item/task-detail-sheet", () => ({
  TaskDetailSheet: () => null,
}));

import { MyWorkbench } from "./my-workbench";

const ACTOR = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
  username: "alice",
  name: "Alice",
};

function makeWorkItemSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    type: "TASK",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Workbench task",
    priority: "MEDIUM",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
    currentStatus: {
      workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
      currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
      stateCode: "IN_PROGRESS",
      stateName: "进行中",
      statusCategory: "IN_PROGRESS",
      lastStatusChangedAt: "2026-05-10T00:00:00.000Z",
    },
    exceptionSignals: [],
    ...overrides,
  };
}

function makeRecentActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FEV",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    target: {
      type: "WORK_ITEM",
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      title: "Workbench task",
    },
    eventType: "WORK_ITEM_UPDATED",
    actor: ACTOR,
    title: "updated the task",
    createdAt: "2026-05-13T22:00:00.000Z",
    ...overrides,
  };
}

function makeWorkbenchSection(items: ReturnType<typeof makeWorkItemSummary>[]) {
  return {
    title: "Section",
    total: items.length,
    items: { items, total: items.length, page: 1, pageSize: 25 },
  };
}

function makeWorkbenchResponse(
  options: {
    withStats?: boolean;
    todos?: ReturnType<typeof makeWorkItemSummary>[];
    dueSoon?: ReturnType<typeof makeWorkItemSummary>[];
    actionTodos?: Array<{ workItem: ReturnType<typeof makeWorkItemSummary> }>;
    blocked?: ReturnType<typeof makeWorkItemSummary>[];
    recent?: ReturnType<typeof makeRecentActivity>[];
  } = {},
) {
  const todos = options.todos ?? [];
  const dueSoon = options.dueSoon ?? [];
  const actionTodos = options.actionTodos ?? [];
  const blocked = options.blocked ?? [];
  const recent = options.recent ?? [];

  const base = {
    filters: {},
    sections: {
      myTodos: makeWorkbenchSection(todos),
      assignedTasks: makeWorkbenchSection([]),
      assignedBugs: makeWorkbenchSection([]),
      actionTodos: {
        title: "Action todos",
        total: actionTodos.length,
        items: {
          items: actionTodos,
          total: actionTodos.length,
          page: 1,
          pageSize: 25,
        },
      },
      pendingConfirm: makeWorkbenchSection([]),
      dueSoon: makeWorkbenchSection(dueSoon),
      blocked: makeWorkbenchSection(blocked),
      recentActivities: {
        title: "Recent",
        total: recent.length,
        items: { items: recent, total: recent.length, page: 1, pageSize: 25 },
      },
    },
  } as Record<string, unknown>;

  if (options.withStats) {
    base.stats = {
      assignedWorkItemCount: 12,
      actionTodoCount: 3,
      overdueCount: 2,
      blockedCount: 4,
      pendingConfirmCount: 5,
      pendingRegressionCount: 1,
      staleCount: 0,
    };
  }

  return base;
}

beforeEach(() => {
  getMyWorkbenchViewMock.mockReset();
  sessionMock.current = {
    session: {
      user: { id: "USR_01", name: "Test User" },
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
  };
});

afterEach(() => {
  cleanup();
});

describe("MyWorkbench", () => {
  it("renders the four KPI summary chips with stat values", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        withStats: true,
        todos: [makeWorkItemSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F01" })],
        dueSoon: [
          makeWorkItemSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F02" }),
          makeWorkItemSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F03" }),
        ],
      }),
    );

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    // Four KPI labels rendered (the chip is just a div, so we just verify text).
    expect(await screen.findByText("workbench.summary.todo")).toBeInTheDocument();
    expect(screen.getByText("workbench.summary.dueSoon")).toBeInTheDocument();
    expect(screen.getByText("workbench.summary.blocked")).toBeInTheDocument();
    expect(
      screen.getByText("workbench.summary.pendingConfirm"),
    ).toBeInTheDocument();

    // Values: todoCount=1, dueSoon=2, blocked=4 (from stats), pendingConfirm=5.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders '—' when stats is missing (graceful degradation)", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({ withStats: false }),
    );

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    // Both blocked and pendingConfirm chips fall back to '—'.
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("renders four task sections (todo, actions, dueSoon, blocked) with their items", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "Todo item one",
          }),
        ],
        dueSoon: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            title: "Due soon item",
          }),
        ],
        actionTodos: [
          {
            workItem: makeWorkItemSummary({
              id: "01ARZ3NDEKTSV4RRFFQ69G5F03",
              title: "Action todo item",
            }),
          },
        ],
        blocked: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F04",
            title: "Blocked item",
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    expect(await screen.findByText("Todo item one")).toBeInTheDocument();
    expect(screen.getByText("Due soon item")).toBeInTheDocument();
    expect(screen.getByText("Action todo item")).toBeInTheDocument();
    expect(screen.getByText("Blocked item")).toBeInTheDocument();

    // Section titles rendered.
    expect(screen.getByText("workbench.sections.todo")).toBeInTheDocument();
    expect(screen.getByText("workbench.sections.actions")).toBeInTheDocument();
    expect(screen.getByText("workbench.sections.dueSoon")).toBeInTheDocument();
    expect(screen.getByText("workbench.sections.blocked")).toBeInTheDocument();
  });

  it("renders the empty blocked section hint when no blocked items returned", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(makeWorkbenchResponse());

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText("workbench.empty.blocked"),
    ).toBeInTheDocument();
  });

  it("renders recent activities in the side panel", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        recent: [
          makeRecentActivity({
            id: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
            title: "edited the description",
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText("workbench.sections.recent"),
    ).toBeInTheDocument();
    expect(screen.getByText("edited the description")).toBeInTheDocument();
  });

  it("renders the empty recent activity hint when none are returned", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(makeWorkbenchResponse());

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText("workbench.empty.recent"),
    ).toBeInTheDocument();
  });

  it("renders the error state when the view fetch rejects", async () => {
    getMyWorkbenchViewMock.mockRejectedValueOnce(new Error("nope"));

    render(<MyWorkbench />);

    expect(
      await screen.findByText("workbench.errorTitle"),
    ).toBeInTheDocument();
  });

  it("renders the no-organization empty state when there is no defaultOrganizationId", async () => {
    sessionMock.current = {
      session: {
        user: { id: "USR_01", name: "Test" },
        defaultOrganizationId: undefined as unknown as string,
        defaultSpaceId: undefined as unknown as string,
      },
      currentSpace: undefined as unknown as never,
    };

    render(<MyWorkbench />);

    expect(
      await screen.findByText("workbench.empty.noOrganization.title"),
    ).toBeInTheDocument();
    expect(getMyWorkbenchViewMock).not.toHaveBeenCalled();
  });

  it("renders the signIn empty state when session is null", async () => {
    sessionMock.current = {
      session: null as unknown as never,
      currentSpace: undefined as unknown as never,
    };

    render(<MyWorkbench />);

    expect(
      await screen.findByText("workbench.empty.signIn.title"),
    ).toBeInTheDocument();
    expect(getMyWorkbenchViewMock).not.toHaveBeenCalled();
  });
});
