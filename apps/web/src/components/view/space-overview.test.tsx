import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<
    string,
    (key: string, vars?: Record<string, unknown>) => string
  >(),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const cacheKey = namespace ?? "__root__";
    let fn = translatorCache.get(cacheKey);
    if (!fn) {
      fn = (k: string, vars?: Record<string, unknown>) => {
        const base = namespace ? `${namespace}.${k}` : k;
        if (vars && Object.keys(vars).length > 0) {
          const parts = Object.entries(vars)
            .map(([vk, vv]) => `${vk}=${String(vv)}`)
            .join(",");
          return `${base}(${parts})`;
        }
        return base;
      };
      translatorCache.set(cacheKey, fn);
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
    asChild?: boolean;
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

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));
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
  getPathname: () => "/overview",
  redirect: () => undefined,
  usePathname: () => "/overview",
  useRouter: () => routerMock,
}));

const searchParamsMock = vi.hoisted(() => ({
  current: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
  } as { session: unknown; currentSpace: unknown },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { getSpaceOverviewViewMock } = vi.hoisted(() => ({
  getSpaceOverviewViewMock: vi.fn(),
}));
vi.mock("../../lib/view-service", () => ({
  getSpaceOverviewView: getSpaceOverviewViewMock,
}));

const versionsMock = vi.hoisted(() => ({
  current: [] as { id: string; name: string }[],
}));
vi.mock("../../lib/v2/lookups", () => ({
  useVersions: () => ({
    versions: versionsMock.current,
    loading: false,
    error: null,
    getVersion: (id: string) => versionsMock.current.find((v) => v.id === id),
  }),
}));

import { SpaceOverview } from "./space-overview";

function makeOverview(overrides: Record<string, unknown> = {}) {
  return {
    space: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      code: "SPACEA",
      status: "ACTIVE",
      settings: { staleThresholdDays: 5 },
    },
    stats: {
      versionCount: 3,
      requirementCount: 12,
      taskCount: 20,
      completedTaskCount: 5,
      bugCount: 8,
      openBugCount: 3,
      blockedCount: 2,
      overdueCount: 4,
    },
    currentVersion: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
      name: "v1.0.0",
      target: "Public beta launch",
      targetDate: "2026-06-01T00:00:00.000Z",
      status: "IN_PROGRESS",
    },
    defaultWorkflows: [],
    statusCounts: [
      { statusCategory: "NOT_STARTED", count: 5 },
      { statusCategory: "IN_PROGRESS", count: 7 },
      { statusCategory: "DONE", count: 8 },
    ],
    taskStatusCounts: [
      { statusCategory: "NOT_STARTED", count: 4 },
      { statusCategory: "IN_PROGRESS", count: 6 },
      { statusCategory: "DONE", count: 5 },
    ],
    bugStatusCounts: [
      { statusCategory: "IN_PROGRESS", count: 1 },
      { statusCategory: "DONE", count: 3 },
    ],
    exceptionCounts: [
      { exceptionType: "overdue", count: 4 },
      { exceptionType: "blocked", count: 2 },
    ],
    recentActivities: {
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          actor: { name: "Charlie", username: "charlie", id: "U1" },
          target: { type: "WORK_ITEM", id: "WI_01", title: "TASK-ABC123" },
          eventType: "UPDATED",
          title: "edited",
          createdAt: "2026-05-13T22:00:00.000Z",
        },
      ],
    },
    staleThresholdDays: 5,
    ...overrides,
  };
}

beforeEach(() => {
  getSpaceOverviewViewMock.mockReset();
  routerMock.replace.mockReset();
  routerMock.push.mockReset();
  searchParamsMock.current = new URLSearchParams();
  versionsMock.current = [];
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
  };
});

afterEach(() => {
  cleanup();
});

describe("SpaceOverview", () => {
  it("renders all major sections with API data", async () => {
    getSpaceOverviewViewMock.mockResolvedValueOnce(makeOverview());

    render(<SpaceOverview />);

    await waitFor(() =>
      expect(getSpaceOverviewViewMock).toHaveBeenCalledTimes(1),
    );

    // Current version hero.
    expect(await screen.findByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Public beta launch")).toBeInTheDocument();
    expect(
      screen.getByTestId("space-overview-current-version"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByTestId("space-overview-version-board-link")
        .getAttribute("href"),
    ).toContain("versionId=01ARZ3NDEKTSV4RRFFQ69G5FV1");
    expect(screen.getByTestId("space-overview-kpi-grid")).toBeInTheDocument();

    // Stale threshold meta strip.
    expect(screen.getByTestId("space-overview-stale")).toHaveTextContent("5");

    // Task progress / bug status tiles render numbers.
    expect(
      screen.getByTestId("space-overview-task-progress"),
    ).toHaveTextContent("5/20");
    expect(screen.getByTestId("space-overview-bug-status")).toHaveTextContent(
      "5/8",
    );

    // Task and bug status distribution chips render their own counts and
    // each chip drills to the correct destination.
    const taskDoneChip = screen.getByTestId("space-overview-task-status-DONE");
    expect(taskDoneChip).toHaveTextContent("5");
    expect(taskDoneChip.getAttribute("href")).toContain("/work-items");
    expect(taskDoneChip.getAttribute("href")).toContain("statusCategory=DONE");
    expect(taskDoneChip.getAttribute("href")).toContain("workItemType=TASK");

    const bugDoneChip = screen.getByTestId(
      "space-overview-bug-status-distribution-DONE",
    );
    expect(bugDoneChip).toHaveTextContent("3");
    expect(bugDoneChip.getAttribute("href")).toContain("/bugs");
    expect(bugDoneChip.getAttribute("href")).toContain("statusCategory=DONE");

    // Categories with zero counts still render (showing "0") so the layout is
    // stable across data states.
    expect(
      screen.getByTestId("space-overview-bug-status-distribution-NOT_STARTED"),
    ).toHaveTextContent("0");

    // All 5 exception chips render (missing ones default to 0).
    expect(
      screen.getByTestId("space-overview-exception-overdue"),
    ).toHaveTextContent("4");
    expect(
      screen.getByTestId("space-overview-exception-blocked"),
    ).toHaveTextContent("2");
    expect(
      screen.getByTestId("space-overview-exception-pending_confirm"),
    ).toHaveTextContent("0");

    // Inline KPI links.
    expect(
      screen.getByTestId("space-overview-requirements-link"),
    ).toHaveTextContent("12");
    expect(
      screen.getByTestId("space-overview-versions-link"),
    ).toHaveTextContent("3");

    // Timeline actor.
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders the empty messages when exceptionCounts and recentActivities are empty", async () => {
    getSpaceOverviewViewMock.mockResolvedValueOnce(
      makeOverview({
        exceptionCounts: [],
        recentActivities: { items: [] },
        statusCounts: [],
        taskStatusCounts: [],
        bugStatusCounts: [],
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
      }),
    );

    render(<SpaceOverview />);

    await waitFor(() =>
      expect(getSpaceOverviewViewMock).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText("spaceOverview.exceptions.empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("spaceOverview.timeline.empty"),
    ).toBeInTheDocument();
    // Both per-type distribution panels render their empty label when no
    // task/bug exists.
    expect(
      screen.getAllByText("spaceOverview.statusCounts.empty"),
    ).toHaveLength(2);
  });

  it("keeps current-version actions stable when there is no current version", async () => {
    getSpaceOverviewViewMock.mockResolvedValueOnce(
      makeOverview({ currentVersion: undefined }),
    );

    render(<SpaceOverview />);

    const versionLink = await screen.findByTestId(
      "space-overview-version-board-link",
    );
    expect(versionLink.getAttribute("href")).toBe("/versions");
    expect(
      screen.getByText("spaceOverview.currentVersion.empty"),
    ).toBeInTheDocument();
  });

  it("renders the error state when the view fetch rejects", async () => {
    getSpaceOverviewViewMock.mockRejectedValueOnce(new Error("network"));

    render(<SpaceOverview />);

    expect(
      await screen.findByText("spaceOverview.errorTitle"),
    ).toBeInTheDocument();
  });

  it("shows the loading state while the view fetch is pending", async () => {
    let resolve: (value: ReturnType<typeof makeOverview>) => void = () => {};
    getSpaceOverviewViewMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    render(<SpaceOverview />);

    expect(
      await screen.findByText("spaceOverview.states.loading.title"),
    ).toBeInTheDocument();

    resolve(
      makeOverview({ exceptionCounts: [], recentActivities: { items: [] } }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("spaceOverview.exceptions.empty"),
      ).toBeInTheDocument(),
    );
  });

  it("renders the unauthenticated empty state when session is null", async () => {
    sessionMock.current = {
      session: null,
      currentSpace: undefined,
    };

    render(<SpaceOverview />);

    expect(
      await screen.findByText("spaceOverview.states.unauthenticated.title"),
    ).toBeInTheDocument();
    expect(getSpaceOverviewViewMock).not.toHaveBeenCalled();
  });

  it("renders the noSpace empty state when session has no defaultSpaceId", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: undefined,
      },
      currentSpace: undefined,
    };

    render(<SpaceOverview />);

    expect(
      await screen.findByText("spaceOverview.noSpace.title"),
    ).toBeInTheDocument();
    expect(getSpaceOverviewViewMock).not.toHaveBeenCalled();
  });

  it("passes versionId from search params into the fetch and syncs URL on change", async () => {
    searchParamsMock.current = new URLSearchParams({ versionId: "V_01" });
    versionsMock.current = [
      { id: "V_01", name: "v0.1" },
      { id: "V_02", name: "v0.2" },
    ];
    getSpaceOverviewViewMock.mockResolvedValue(makeOverview());

    render(<SpaceOverview />);

    await waitFor(() =>
      expect(getSpaceOverviewViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ versionId: "V_01" }),
      ),
    );

    // Filter trigger reflects the selected version.
    expect(
      screen.getByTestId("space-overview-version-filter-trigger"),
    ).toHaveTextContent("v0.1");

    // Selecting another version replaces the search param.
    fireEvent.click(
      screen.getByTestId("space-overview-version-filter-trigger"),
    );
    const opt = await screen.findByTestId(
      "space-overview-version-filter-option-V_02",
    );
    fireEvent.click(opt);

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        expect.stringContaining("versionId=V_02"),
        expect.objectContaining({ scroll: false }),
      ),
    );
  });

  it("clears old overview data while the selected version is reloading", async () => {
    let resolveSecond: (
      value: ReturnType<typeof makeOverview>,
    ) => void = () => {};
    getSpaceOverviewViewMock
      .mockResolvedValueOnce(
        makeOverview({
          currentVersion: {
            id: "V_OLD",
            name: "Old overview version",
            target: "Old target",
            targetDate: "2026-06-01T00:00:00.000Z",
            status: "IN_PROGRESS",
          },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { rerender } = render(<SpaceOverview />);

    expect(await screen.findByText("Old overview version")).toBeInTheDocument();

    versionsMock.current = [{ id: "V_NEW", name: "New version" }];
    searchParamsMock.current = new URLSearchParams({ versionId: "V_NEW" });
    rerender(<SpaceOverview />);

    await waitFor(() =>
      expect(
        screen.queryByText("Old overview version"),
      ).not.toBeInTheDocument(),
    );

    resolveSecond(
      makeOverview({
        currentVersion: {
          id: "V_NEW",
          name: "New overview version",
          target: "New target",
          targetDate: "2026-07-01T00:00:00.000Z",
          status: "IN_PROGRESS",
        },
      }),
    );

    expect(await screen.findByText("New overview version")).toBeInTheDocument();
  });

  it("triggers a manual refetch when the refresh button is clicked", async () => {
    getSpaceOverviewViewMock.mockResolvedValue(makeOverview());

    render(<SpaceOverview />);

    await waitFor(() =>
      expect(getSpaceOverviewViewMock).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByTestId("space-overview-refresh"));
    await waitFor(() =>
      expect(getSpaceOverviewViewMock).toHaveBeenCalledTimes(2),
    );
  });

  it("builds exception drill-down links carrying the current versionId", async () => {
    searchParamsMock.current = new URLSearchParams({ versionId: "V_99" });
    versionsMock.current = [{ id: "V_99", name: "v0.99" }];
    getSpaceOverviewViewMock.mockResolvedValue(makeOverview());

    render(<SpaceOverview />);

    const overdueLink = await screen.findByTestId(
      "space-overview-exception-overdue",
    );
    expect(overdueLink.getAttribute("href")).toContain("exceptionType=overdue");
    expect(overdueLink.getAttribute("href")).toContain("versionId=V_99");

    const taskDoneChip = screen.getByTestId("space-overview-task-status-DONE");
    expect(taskDoneChip.getAttribute("href")).toContain("versionId=V_99");
    expect(taskDoneChip.getAttribute("href")).toContain("workItemType=TASK");
  });

  it("removes stale versionId params and does not send them to the overview API", async () => {
    searchParamsMock.current = new URLSearchParams({ versionId: "V_OLD" });
    versionsMock.current = [{ id: "V_CURRENT", name: "Current version" }];
    getSpaceOverviewViewMock.mockResolvedValue(makeOverview());

    render(<SpaceOverview />);

    await waitFor(() =>
      expect(getSpaceOverviewViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ versionId: undefined }),
      ),
    );
    expect(routerMock.replace).toHaveBeenCalledWith(
      expect.not.stringContaining("versionId=V_OLD"),
      expect.objectContaining({ scroll: false }),
    );
  });
});
