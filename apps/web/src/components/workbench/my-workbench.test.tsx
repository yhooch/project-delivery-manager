import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rootTranslations, routerPushMock, translatorCache } = vi.hoisted(
  () => ({
    rootTranslations: {
      "common.workflowDefaults.actions.START_PROGRESS": "开始处理",
      "common.workflowDefaults.states.IN_PROGRESS": "处理中",
    } as Record<string, string>,
    routerPushMock: vi.fn(),
    translatorCache: new Map<
      string,
      ((key: string) => string) & { has?: (key: string) => boolean }
    >(),
  }),
);
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string) =>
        namespace ? `${namespace}.${k}` : (rootTranslations[k] ?? k);
      fn.has = (k: string) =>
        namespace ? false : Object.hasOwn(rootTranslations, k);
      translatorCache.set(key, fn);
    }
    return fn;
  },
  useLocale: () => "zh-CN",
}));

vi.mock("../ui/dropdown-menu", async () => {
  const React = await import("react");
  type AnyProps = Record<string, unknown> & {
    children?: React.ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
  };
  return {
    DropdownMenu: ({ children }: AnyProps) =>
      React.createElement("div", null, children),
    DropdownMenuTrigger: ({ children }: AnyProps) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuContent: ({ children }: AnyProps) =>
      React.createElement("div", { role: "menu" }, children),
    DropdownMenuLabel: ({ children }: AnyProps) =>
      React.createElement("span", null, children),
    DropdownMenuSeparator: () => React.createElement("hr"),
    DropdownMenuItem: ({ children, onSelect, ...rest }: AnyProps) =>
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => onSelect?.({ preventDefault: () => {} }),
          ...rest,
        },
        children,
      ),
  };
});

vi.mock("../../i18n/routing", () => ({
  routing: { defaultLocale: "zh-CN", locales: ["zh-CN", "en-US"] },
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/",
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      user: { id: "USR_01", name: "Test User" },
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentOrganization: { id: "ORG_01", name: "Org A" },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
    spacesForCurrentOrganization: [
      { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
      { id: "SPC_02", organizationId: "ORG_01", name: "Space B" },
    ],
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

type RealtimeCallback = (context: {
  events: unknown[];
  keys: string[];
  lastEventId: string | null;
  mode: "realtime";
  resyncs: unknown[];
}) => void | Promise<void>;

const { realtimeCallbacks } = vi.hoisted(() => ({
  realtimeCallbacks: new Map<string, RealtimeCallback>(),
}));
vi.mock("../../lib/realtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/realtime")>(
      "../../lib/realtime",
    );

  return {
    ...actual,
    useRealtimeInvalidation: (
      keys: readonly string[],
      callback: RealtimeCallback,
    ) => {
      keys.forEach((key) => realtimeCallbacks.set(key, callback));
    },
  };
});

const { getMembersMock, getVersionsMock } = vi.hoisted(() => ({
  getMembersMock: vi.fn(),
  getVersionsMock: vi.fn(),
}));

// Lookups: hooks stay inert for selected-space mode. Organization-level tests
// exercise the exported async helpers used for grouped prefetch.
vi.mock("../../lib/v2/lookups", () => ({
  getMembers: getMembersMock,
  getVersions: getVersionsMock,
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

import { MyWorkbench } from "./my-workbench";
import { createRecentStorageKey } from "../shell/recent-opens";

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
    eventType: "UPDATED",
    actor: ACTOR,
    title: "updated the task",
    createdAt: "2026-05-13T22:00:00.000Z",
    ...overrides,
  };
}

function makeActionTodo(
  workItem: ReturnType<typeof makeWorkItemSummary>,
  overrides: Record<string, unknown> = {},
) {
  const actionId =
    (overrides.actionId as string | undefined) ?? "01ARZ3NDEKTSV4RRFFQ69G5AC1";

  return {
    id: `${workItem.id}:${actionId}`,
    workItem,
    availableAction: {
      code: "START",
      formFields: [],
      fromStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
      id: actionId,
      name: "Start work",
      order: 0,
      requiresComment: false,
      toStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCT",
    },
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
    assignedTasks?: ReturnType<typeof makeWorkItemSummary>[];
    assignedBugs?: ReturnType<typeof makeWorkItemSummary>[];
    dueSoon?: ReturnType<typeof makeWorkItemSummary>[];
    actionTodos?: ReturnType<typeof makeActionTodo>[];
    pendingConfirm?: ReturnType<typeof makeWorkItemSummary>[];
    blocked?: ReturnType<typeof makeWorkItemSummary>[];
    recent?: ReturnType<typeof makeRecentActivity>[];
  } = {},
) {
  const todos = options.todos ?? [];
  const assignedTasks = options.assignedTasks ?? [];
  const assignedBugs = options.assignedBugs ?? [];
  const dueSoon = options.dueSoon ?? [];
  const actionTodos = options.actionTodos ?? [];
  const pendingConfirm = options.pendingConfirm ?? [];
  const blocked = options.blocked ?? [];
  const recent = options.recent ?? [];

  const base = {
    filters: {},
    sections: {
      myTodos: makeWorkbenchSection(todos),
      assignedTasks: makeWorkbenchSection(assignedTasks),
      assignedBugs: makeWorkbenchSection(assignedBugs),
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
      pendingConfirm: makeWorkbenchSection(pendingConfirm),
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
  realtimeCallbacks.clear();
  routerPushMock.mockReset();
  getMyWorkbenchViewMock.mockReset();
  getMembersMock.mockReset();
  getMembersMock.mockResolvedValue([]);
  getVersionsMock.mockReset();
  getVersionsMock.mockResolvedValue([]);
  sessionMock.current = {
    session: {
      user: { id: "USR_01", name: "Test User" },
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentOrganization: { id: "ORG_01", name: "Org A" },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
    spacesForCurrentOrganization: [
      { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
      { id: "SPC_02", organizationId: "ORG_01", name: "Space B" },
    ],
  };
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("MyWorkbench", () => {
  it("loads organization-level data by default and narrows only after a space is selected", async () => {
    getMyWorkbenchViewMock.mockResolvedValue(makeWorkbenchResponse());

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );
    expect(getMyWorkbenchViewMock.mock.calls[0]?.[0]).toEqual({
      organizationId: "ORG_01",
      spaceId: undefined,
    });

    fireEvent.click(screen.getByTestId("workbench-space-filter-option-SPC_02"));

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(2),
    );
    expect(getMyWorkbenchViewMock.mock.calls[1]?.[0]).toEqual({
      organizationId: "ORG_01",
      spaceId: "SPC_02",
    });
  });

  it("renders the KPI summary chips with stat values", async () => {
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

    expect(
      await screen.findByText("workbench.summary.todo"),
    ).toBeInTheDocument();
    expect(screen.getByText("workbench.summary.dueSoon")).toBeInTheDocument();
    expect(screen.getByText("workbench.summary.blocked")).toBeInTheDocument();
    expect(
      screen.getByText("workbench.summary.pendingConfirm"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("workbench.summary.pendingRegression"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("workbench.summary.stale"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("workbench-summary").children).toHaveLength(4);

    const summary = screen.getByTestId("workbench-summary");
    // Values: todoCount=1, dueSoon=2, blocked=4, pendingConfirm=5.
    expect(within(summary).getByText("1")).toBeInTheDocument();
    expect(within(summary).getByText("2")).toBeInTheDocument();
    expect(within(summary).getByText("4")).toBeInTheDocument();
    expect(within(summary).getByText("5")).toBeInTheDocument();
  });

  it("uses a dash when pendingConfirmCount is missing", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        withStats: false,
        blocked: [makeWorkItemSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F06" })],
        pendingConfirm: [
          makeWorkItemSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F07" }),
          makeWorkItemSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F08" }),
        ],
      }),
    );

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    const summary = await screen.findByTestId("workbench-summary");
    expect(within(summary).getByText("1")).toBeInTheDocument();
    expect(within(summary).getByText("—")).toBeInTheDocument();
  });

  it("sends frozen workbench filter parameters to the view request", async () => {
    const versionId = "VERSION_01";
    const assigneeId = "ASSIGNEE_01";

    getVersionsMock.mockResolvedValue([{ id: versionId, name: "Release 1" }]);
    getMembersMock.mockResolvedValue([
      {
        id: "MEMBER_01",
        userId: assigneeId,
        user: { id: assigneeId, name: "Alice", username: "alice" },
      },
    ]);
    getMyWorkbenchViewMock.mockResolvedValue(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            assigneeId,
            id: "01ARZ3NDEKTSV4RRFFQ69G5F31",
            versionId,
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    const filterButton = screen.getByTestId("workbench-filter-button");
    expect(filterButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("workbench-filter-panel"),
    ).not.toBeInTheDocument();

    fireEvent.click(filterButton);

    expect(filterButton).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findAllByText("Release 1")).not.toHaveLength(0);

    fireEvent.click(
      within(
        screen.getByRole("group", { name: "m4Views.filters.version" }),
      ).getByRole("button", { name: "Release 1" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "m4Views.filters.assignee" }),
      ).getByRole("button", { name: "Alice" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "m4Views.filters.statusCategory" }),
      ).getByRole("button", { name: "m4Views.statusCategory.VERIFYING" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "m4Views.filters.workItemType" }),
      ).getByRole("button", { name: "m4Views.workItemType.BUG" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "m4Views.filters.exceptionType" }),
      ).getByRole("button", {
        name: "m4Views.exceptionType.pending_regression",
      }),
    );

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeId,
          exceptionType: "pending_regression",
          organizationId: "ORG_01",
          statusCategory: "VERIFYING",
          versionId,
          workItemType: "BUG",
        }),
      ),
    );

    fireEvent.mouseDown(document.body);
    expect(filterButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("workbench-filter-panel"),
    ).not.toBeInTheDocument();
  });

  it("renders the IA-approved workbench sections with their items", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "Todo item one",
            currentStatus: {
              workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
              currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
              stateCode: "PRODUCT_REVIEW",
              stateName: "产品验证中",
              statusCategory: "VERIFYING",
              lastStatusChangedAt: "2026-05-10T00:00:00.000Z",
            },
          }),
        ],
        assignedTasks: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F11",
            title: "Assigned task item",
          }),
        ],
        assignedBugs: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F12",
            title: "Assigned bug item",
            type: "BUG",
          }),
        ],
        dueSoon: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            title: "Due soon item",
          }),
        ],
        actionTodos: [
          makeActionTodo(
            makeWorkItemSummary({
              id: "01ARZ3NDEKTSV4RRFFQ69G5F03",
              title: "Action todo item",
            }),
          ),
        ],
        pendingConfirm: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F13",
            title: "Pending confirm item",
          }),
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
    expect(screen.getByText("产品验证中")).toBeInTheDocument();
    expect(screen.getByText("Assigned task item")).toBeInTheDocument();
    expect(screen.getByText("Assigned bug item")).toBeInTheDocument();
    expect(screen.getByText("Due soon item")).toBeInTheDocument();
    expect(screen.getByText("Action todo item")).toBeInTheDocument();
    expect(screen.getByText("Pending confirm item")).toBeInTheDocument();
    expect(screen.getByText("Blocked item")).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "workbench.sections.todo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "workbench.sections.assignedTasks",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "workbench.sections.assignedBugs",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "workbench.sections.actions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "workbench.sections.pendingConfirm",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "workbench.sections.dueSoon" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "workbench.sections.blocked" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "workbench.sections.recent" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "workbench.sections.risk" }),
    ).not.toBeInTheDocument();
  });

  it("localizes default workflow action and state labels by stable code", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        actionTodos: [
          makeActionTodo(
            makeWorkItemSummary({
              currentStatus: {
                workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
                currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
                stateCode: "IN_PROGRESS",
                stateName: "In progress",
                statusCategory: "IN_PROGRESS",
                lastStatusChangedAt: "2026-05-10T00:00:00.000Z",
              },
            }),
            {
              availableAction: {
                code: "START_PROGRESS",
                formFields: [],
                fromStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
                id: "01ARZ3NDEKTSV4RRFFQ69G5AC1",
                name: "Start progress",
                order: 0,
                requiresComment: false,
                toStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCT",
              },
            },
          ),
        ],
      }),
    );

    render(<MyWorkbench />);

    expect(await screen.findByText("开始处理")).toBeInTheDocument();
    expect(screen.getByText("处理中")).toBeInTheDocument();
    expect(screen.queryByText("Start progress")).not.toBeInTheDocument();
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });

  it("preloads organization-level version names by item space without leaking ID tails", async () => {
    getVersionsMock.mockImplementation(async (spaceId: string) =>
      spaceId === "SPC_02"
        ? [{ id: "VERSION_ULID_TAIL_9XYZ", name: "Release train" }]
        : [],
    );
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F21",
            spaceId: "SPC_02",
            title: "Cross-space version item",
            versionId: "VERSION_ULID_TAIL_9XYZ",
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    expect(
      await screen.findByText("Cross-space version item"),
    ).toBeInTheDocument();
    expect(await screen.findAllByText("Release train")).not.toHaveLength(0);
    expect(screen.queryByText("9XYZ")).not.toBeInTheDocument();
    expect(getVersionsMock).toHaveBeenCalledWith("SPC_02", "ORG_01");
  });

  it("shows space context for organization-level work item codes", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F23",
            displayCode: "TASK-1",
            spaceId: "SPC_02",
            title: "Cross-space duplicate code",
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    expect(
      await screen.findByText("Cross-space duplicate code"),
    ).toBeInTheDocument();
    const item = screen.getByText("Cross-space duplicate code").closest("li");

    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByText("TASK-1")).toBeInTheDocument();
    expect(
      within(item as HTMLElement).getByText("Space B"),
    ).toBeInTheDocument();
  });

  it("uses a readable version fallback instead of a raw ID tail when lookups miss", async () => {
    getVersionsMock.mockResolvedValue([]);
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F22",
            spaceId: "SPC_02",
            title: "Unknown version item",
            versionId: "VERSION_ULID_TAIL_9XYZ",
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    expect(await screen.findByText("Unknown version item")).toBeInTheDocument();
    expect(
      await screen.findByText("workbench.versionFallback"),
    ).toBeInTheDocument();
    expect(screen.queryByText("9XYZ")).not.toBeInTheDocument();
  });

  it("keeps action todos distinct when one work item has multiple available actions", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const workItem = makeWorkItemSummary({
      id: "01ARZ3NDEKTSV4RRFFQ69G5F05",
      title: "Multi-action item",
    });

    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        actionTodos: [
          makeActionTodo(workItem, {
            actionId: "01ARZ3NDEKTSV4RRFFQ69G5A01",
            availableAction: {
              code: "START_REVIEW",
              formFields: [],
              fromStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
              id: "01ARZ3NDEKTSV4RRFFQ69G5A01",
              name: "Start review",
              order: 0,
              requiresComment: false,
              toStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCT",
            },
          }),
          makeActionTodo(workItem, {
            actionId: "01ARZ3NDEKTSV4RRFFQ69G5A02",
            availableAction: {
              code: "ESCALATE",
              formFields: [],
              fromStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
              id: "01ARZ3NDEKTSV4RRFFQ69G5A02",
              name: "Escalate",
              order: 1,
              requiresComment: false,
              toStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCT",
            },
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    expect(await screen.findAllByText("Multi-action item")).toHaveLength(2);
    expect(screen.getByText("Start review")).toBeInTheDocument();
    expect(screen.getByText("Escalate")).toBeInTheDocument();
    expect(
      consoleError.mock.calls.filter((call) =>
        call.some((arg) => String(arg).includes("same key")),
      ),
    ).toHaveLength(0);

    consoleError.mockRestore();
  });

  it("renders independent empty hints when no due-soon or blocked items are returned", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(makeWorkbenchResponse());

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText("workbench.empty.dueSoon"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("workbench.empty.blocked"),
    ).toBeInTheDocument();
  });

  it("clears stale workbench data while switching spaces", async () => {
    let resolveSecond: (
      value: ReturnType<typeof makeWorkbenchResponse>,
    ) => void = () => {};
    getMyWorkbenchViewMock
      .mockResolvedValueOnce(
        makeWorkbenchResponse({
          todos: [
            makeWorkItemSummary({
              id: "01ARZ3NDEKTSV4RRFFQ69G5FS1",
              title: "Old space item",
            }),
          ],
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    render(<MyWorkbench />);

    const oldItem = await screen.findByText("Old space item");
    expect(oldItem).toBeInTheDocument();

    fireEvent.click(oldItem);
    expect(routerPushMock).toHaveBeenCalledWith(
      "/work-items?spaceId=SPC_01&workItemId=01ARZ3NDEKTSV4RRFFQ69G5FS1",
    );

    fireEvent.click(screen.getByTestId("workbench-space-filter-option-SPC_02"));

    await waitFor(() =>
      expect(screen.queryByText("Old space item")).not.toBeInTheDocument(),
    );

    resolveSecond(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5FS2",
            spaceId: "SPC_02",
            title: "New space item",
          }),
        ],
      }),
    );
    expect(await screen.findByText("New space item")).toBeInTheDocument();
  });

  it("records direct workbench opens and routes to the item space", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5FRC",
            title: "Remember workbench item",
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    fireEvent.click(await screen.findByText("Remember workbench item"));
    expect(routerPushMock).toHaveBeenCalledWith(
      "/work-items?spaceId=SPC_01&workItemId=01ARZ3NDEKTSV4RRFFQ69G5FRC",
    );

    const stored = JSON.parse(
      window.localStorage.getItem(
        createRecentStorageKey({
          organizationId: "ORG_01",
          spaceId: "SPC_01",
        }),
      ) ?? "[]",
    ) as Array<{
      displayCode: string;
      href: string;
      spaceId: string;
      title: string;
      type: string;
    }>;
    expect(stored[0]).toMatchObject({
      displayCode: "TASK-9G5FRC",
      href: "/work-items?spaceId=SPC_01&workItemId=01ARZ3NDEKTSV4RRFFQ69G5FRC",
      spaceId: "SPC_01",
      title: "Remember workbench item",
      type: "TASK",
    });
  });

  it("keeps the current workbench DOM while realtime refresh is pending", async () => {
    let resolveRealtime: (
      value: ReturnType<typeof makeWorkbenchResponse>,
    ) => void = () => {};
    getMyWorkbenchViewMock
      .mockResolvedValueOnce(
        makeWorkbenchResponse({
          todos: [
            makeWorkItemSummary({
              id: "01ARZ3NDEKTSV4RRFFQ69G5RT1",
              title: "Old realtime workbench item",
            }),
          ],
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRealtime = resolve;
          }),
      );

    render(<MyWorkbench />);

    expect(
      await screen.findByText("Old realtime workbench item"),
    ).toBeInTheDocument();

    const callback = realtimeCallbacks.get("workbench");
    if (!callback) {
      throw new Error("Expected workbench realtime callback to be registered");
    }

    await act(async () => {
      await callback({
        events: [],
        keys: ["workbench"],
        lastEventId: null,
        mode: "realtime",
        resyncs: [],
      });
    });

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByText("Old realtime workbench item")).toBeInTheDocument();
    expect(screen.queryByText("workbench.errorTitle")).not.toBeInTheDocument();

    await act(async () => {
      resolveRealtime(
        makeWorkbenchResponse({
          todos: [
            makeWorkItemSummary({
              id: "01ARZ3NDEKTSV4RRFFQ69G5RT2",
              title: "New realtime workbench item",
            }),
          ],
        }),
      );
    });

    expect(
      await screen.findByText("New realtime workbench item"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Old realtime workbench item"),
    ).not.toBeInTheDocument();
  });

  it("supports J/K/Enter/E keyboard paths and routes the active item", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        todos: [
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5FK1",
            title: "Keyboard first item",
          }),
          makeWorkItemSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5FK2",
            title: "Keyboard second item",
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    const firstTitle = await screen.findByText("Keyboard first item");
    const secondTitle = await screen.findByText("Keyboard second item");
    const firstButton = firstTitle.closest("button");
    const secondButton = secondTitle.closest("button");
    if (!firstButton || !secondButton) {
      throw new Error("Expected workbench keyboard rows to render as buttons");
    }

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(firstButton).toHaveFocus());

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(secondButton).toHaveFocus());

    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(firstButton).toHaveFocus());

    fireEvent.keyDown(window, { key: "Enter" });
    expect(routerPushMock).toHaveBeenCalledWith(
      "/work-items?spaceId=SPC_01&workItemId=01ARZ3NDEKTSV4RRFFQ69G5FK1",
    );

    fireEvent.keyDown(window, { key: "e" });
    expect(routerPushMock).toHaveBeenLastCalledWith(
      "/work-items?spaceId=SPC_01&workItemId=01ARZ3NDEKTSV4RRFFQ69G5FK1",
    );
  });

  it("uses S on an action todo to open detail with the preferred action selected", async () => {
    const item = makeWorkItemSummary({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA7",
      title: "Action shortcut item",
    });
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        actionTodos: [makeActionTodo(item, { actionId: "ACT_APPROVE" })],
      }),
    );

    render(<MyWorkbench />);

    await screen.findByText("Action shortcut item");
    fireEvent.keyDown(window, { key: "j" });

    const submitEvent = new KeyboardEvent("keydown", {
      key: "s",
      cancelable: true,
    });
    window.dispatchEvent(submitEvent);

    expect(submitEvent.defaultPrevented).toBe(true);
    expect(routerPushMock).toHaveBeenCalledWith(
      "/work-items?spaceId=SPC_01&workItemId=01ARZ3NDEKTSV4RRFFQ69G5FA7&focusActions=1&actionId=ACT_APPROVE",
    );
  });

  it("renders recent activities in the side panel", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        recent: [
          makeRecentActivity({
            id: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
            metadata: { workItemType: "TASK" },
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
    expect(
      screen.getByText("common.timeline.event.UPDATED"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("edited the description"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Workbench task").closest("a")).toHaveAttribute(
      "href",
      "/work-items?workItemId=01ARZ3NDEKTSV4RRFFQ69G5FA1&spaceId=SPC_01&eventId=01ARZ3NDEKTSV4RRFFQ69G5FE1&panel=timeline",
    );
  });

  it("shows space context for organization-level recent activities", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        recent: [
          makeRecentActivity({
            id: "01ARZ3NDEKTSV4RRFFQ69G5FE3",
            spaceId: "SPC_02",
            metadata: { workItemType: "TASK" },
            target: {
              type: "WORK_ITEM",
              id: "01ARZ3NDEKTSV4RRFFQ69G5FBU",
              title: "Cross-space recent task",
            },
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    expect(
      await screen.findByText("Cross-space recent task"),
    ).toBeInTheDocument();
    expect(screen.getByText(/· Space B/u)).toBeInTheDocument();
    expect(
      screen.getByText("Cross-space recent task").closest("a"),
    ).toHaveAttribute(
      "href",
      "/work-items?workItemId=01ARZ3NDEKTSV4RRFFQ69G5FBU&spaceId=SPC_02&eventId=01ARZ3NDEKTSV4RRFFQ69G5FE3&panel=timeline",
    );
  });

  it("links recent activities when the timeline helper can resolve the target", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(
      makeWorkbenchResponse({
        recent: [
          makeRecentActivity({
            id: "01ARZ3NDEKTSV4RRFFQ69G5FE2",
            metadata: { workItemType: "BUG" },
            target: {
              type: "WORK_ITEM",
              id: "01ARZ3NDEKTSV4RRFFQ69G5FBU",
              title: "Workbench bug",
            },
          }),
        ],
      }),
    );

    render(<MyWorkbench />);

    const title = await screen.findByText("Workbench bug");
    expect(title.closest("a")).toHaveAttribute(
      "href",
      "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FBU&spaceId=SPC_01&eventId=01ARZ3NDEKTSV4RRFFQ69G5FE2&panel=timeline",
    );
  });

  it("renders workbench header actions as navigable links", async () => {
    getMyWorkbenchViewMock.mockResolvedValueOnce(makeWorkbenchResponse());

    render(<MyWorkbench />);

    await waitFor(() =>
      expect(getMyWorkbenchViewMock).toHaveBeenCalledTimes(1),
    );

    expect(
      screen.getByRole("link", { name: "workbench.viewAll" }),
    ).toHaveAttribute("href", "/work-items?workItemType=TASK");
    expect(
      screen.getByRole("link", { name: "workbench.sections.recent" }),
    ).toHaveAttribute("href", "/overview");
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

    expect(await screen.findByText("workbench.errorTitle")).toBeInTheDocument();
  });

  it("renders the no-organization empty state when there is no defaultOrganizationId", async () => {
    sessionMock.current = {
      session: {
        user: { id: "USR_01", name: "Test" },
        defaultOrganizationId: undefined as unknown as string,
        defaultSpaceId: undefined as unknown as string,
      },
      currentOrganization: undefined as unknown as never,
      currentSpace: undefined as unknown as never,
      spacesForCurrentOrganization: [],
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
      currentOrganization: undefined as unknown as never,
      currentSpace: undefined as unknown as never,
      spacesForCurrentOrganization: [],
    };

    render(<MyWorkbench />);

    expect(
      await screen.findByText("workbench.empty.signIn.title"),
    ).toBeInTheDocument();
    expect(getMyWorkbenchViewMock).not.toHaveBeenCalled();
  });
});
