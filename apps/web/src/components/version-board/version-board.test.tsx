import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------------
// Mocks — registered BEFORE importing the component under test. We mock the
// i18n translator so every key path comes back verbatim, which makes
// assertions trivial and decouples them from copy edits.
// -----------------------------------------------------------------------------

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

// Replace Radix DropdownMenu with inline buttons so jsdom can fire onSelect
// without going through the Radix portal pipeline.
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

// Replace Radix Tabs with a controlled-style stub that always renders all
// panels but switches the active panel via onValueChange. This avoids Radix's
// "hidden" attribute on inactive tabs so findByText in tests works after a
// click.
vi.mock("../ui/tabs", async () => {
  const React = await import("react");
  type AnyProps = Record<string, unknown> & {
    children?: React.ReactNode;
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
  };
  const TabsContext = React.createContext<{
    value: string;
    setValue: (v: string) => void;
  }>({ value: "", setValue: () => {} });
  return {
    Tabs: ({ children, value, defaultValue, onValueChange }: AnyProps) => {
      const [internal, setInternal] = React.useState(defaultValue ?? "");
      const current = value ?? internal;
      const setValue = (next: string) => {
        if (value === undefined) setInternal(next);
        onValueChange?.(next);
      };
      return React.createElement(
        TabsContext.Provider,
        { value: { value: current, setValue } },
        children,
      );
    },
    TabsList: ({ children, ...rest }: AnyProps) =>
      React.createElement("div", rest, children),
    TabsTrigger: ({ children, value, ...rest }: AnyProps) => {
      const ctx = React.useContext(TabsContext);
      return React.createElement(
        "button",
        {
          type: "button",
          onClick: () => ctx.setValue(value as string),
          ...rest,
        },
        children,
      );
    },
    TabsContent: ({ children, value, ...rest }: AnyProps) => {
      const ctx = React.useContext(TabsContext);
      if (ctx.value !== value) return null;
      return React.createElement("div", rest, children);
    },
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
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/",
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
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "PM",
      status: "ACTIVE",
    },
  } as {
    session: { defaultOrganizationId: string; defaultSpaceId?: string } | null;
    currentSpace: {
      id: string;
      organizationId: string;
      name: string;
      role: string;
      status: string;
    } | null;
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

// useSpaceMembers — keep deterministic; tests can mutate the inner map.
const memberMap = new Map<
  string,
  { user: { name: string; username: string; avatar?: string } }
>();
const memberList = [
  {
    userId: "USR_ALICE",
    user: { name: "Alice", username: "alice", avatar: undefined },
  },
  {
    userId: "USR_BOB",
    user: { name: "Bob", username: "bob", avatar: undefined },
  },
];
memberMap.set("USR_ALICE", memberList[0]!);
memberMap.set("USR_BOB", memberList[1]!);

vi.mock("../../lib/v2/lookups", () => ({
  useSpaceMembers: () => ({
    members: memberList,
    loading: false,
    error: null,
    getMember: (id: string) => memberMap.get(id),
  }),
  useVersions: () => ({
    versions: [],
    loading: false,
    error: null,
    getVersion: () => undefined,
  }),
}));

const {
  listVersionsMock,
  getVersionBoardViewMock,
  listRequirementsMock,
  listTimelineMock,
  createVersionMock,
  updateVersionMock,
} = vi.hoisted(() => ({
  listVersionsMock: vi.fn(),
  getVersionBoardViewMock: vi.fn(),
  listRequirementsMock: vi.fn(),
  listTimelineMock: vi.fn(),
  createVersionMock: vi.fn(),
  updateVersionMock: vi.fn(),
}));

vi.mock("../../lib/version-service", () => ({
  listVersions: listVersionsMock,
  createVersion: createVersionMock,
  updateVersion: updateVersionMock,
}));
vi.mock("../../lib/view-service", () => ({
  getVersionBoardView: getVersionBoardViewMock,
}));
vi.mock("../../lib/requirement-service", () => ({
  listRequirements: listRequirementsMock,
}));
vi.mock("../../lib/timeline-service", () => ({
  listTimeline: listTimelineMock,
}));

// Inert dialogs/sheets so Radix portals stay quiet. Each mock captures the
// `onCreated` / `onUpdated` / `onChanged` callbacks so tests can invoke them
// to assert refresh behaviour.
const { capturedHandlers } = vi.hoisted(() => ({
  capturedHandlers: {
    createVersionOnCreated: null as ((v: unknown) => void) | null,
    editVersionOnUpdated: null as ((v: unknown) => void) | null,
    detailSheetOnChanged: null as (() => void) | null,
    createTaskOnCreated: null as (() => void) | null,
  },
}));

vi.mock("../work-item/create-task-dialog", () => ({
  CreateTaskDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated?: () => void;
  }) => {
    capturedHandlers.createTaskOnCreated = onCreated ?? null;
    return open ? <div data-testid="create-task-dialog-open" /> : null;
  },
}));
vi.mock("../work-item/task-detail-sheet", () => ({
  TaskDetailSheet: ({
    item,
    open,
    onChanged,
  }: {
    item: { id: string; title: string } | null;
    open: boolean;
    onChanged?: () => void;
  }) => {
    capturedHandlers.detailSheetOnChanged = onChanged ?? null;
    return open && item ? (
      <div data-testid="task-detail-sheet-open">
        <span data-testid="task-detail-sheet-item-title">{item.title}</span>
        <button
          type="button"
          data-testid="task-detail-sheet-fire-changed"
          onClick={() => onChanged?.()}
        >
          fire-change
        </button>
      </div>
    ) : null;
  },
}));
vi.mock("./create-version-dialog", () => ({
  CreateVersionDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated?: (v: unknown) => void;
  }) => {
    capturedHandlers.createVersionOnCreated = onCreated ?? null;
    return open ? <div data-testid="create-version-dialog-open" /> : null;
  },
}));
vi.mock("./edit-version-dialog", () => ({
  EditVersionDialog: ({
    open,
    onUpdated,
  }: {
    open: boolean;
    onUpdated?: (v: unknown) => void;
  }) => {
    capturedHandlers.editVersionOnUpdated = onUpdated ?? null;
    return open ? <div data-testid="edit-version-dialog-open" /> : null;
  },
}));

import { VersionPage } from "./version-board";

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    name: "v1.0.0",
    status: "IN_PROGRESS",
    target: "Ship login",
    description: "Initial release",
    ownerId: "USR_ALICE",
    startDate: "2026-05-01T00:00:00.000Z",
    targetDate: "2026-05-20T00:00:00.000Z",
    releaseDate: undefined,
    stats: {
      requirementCount: 3,
      taskCount: 7,
      bugCount: 2,
      blockedCount: 1,
    },
    ...overrides,
  } as unknown as import("@project-delivery/shared").Version;
}

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    type: "TASK",
    title: "Login work item",
    priority: "MEDIUM",
    assigneeId: "USR_ALICE",
    versionId: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
    currentStatus: {
      workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
      currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
      stateCode: "IN_PROGRESS",
      stateName: "进行中",
      statusCategory: "IN_PROGRESS",
      lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
    },
    exceptionSignals: [],
    ...overrides,
  };
}

function makeBoardResponse(items: ReturnType<typeof makeSummary>[]) {
  return {
    columns: [
      { statusCategory: "NOT_STARTED", total: 0 },
      {
        statusCategory: "IN_PROGRESS",
        total: items.filter(
          (i) => i.currentStatus.statusCategory === "IN_PROGRESS",
        ).length,
      },
      { statusCategory: "WAITING", total: 0 },
      { statusCategory: "VERIFYING", total: 0 },
      { statusCategory: "DONE", total: 0 },
      { statusCategory: "TERMINATED", total: 0 },
    ],
    items: { items, total: items.length, page: 1, pageSize: 200 },
  };
}

function makeRequirement(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    versionId: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
    title: "Login requirement",
    summary: "Login flow spec",
    status: "CONFIRMED",
    ownerId: "USR_ALICE",
    updatedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  } as unknown as import("@project-delivery/shared").Requirement;
}

function makeTimelineEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    target: {
      type: "VERSION",
      id: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
    },
    eventType: "STATUS_CHANGED",
    actor: {
      id: "USR_ALICE",
      username: "alice",
      name: "Alice",
    },
    title: "moved version to IN_PROGRESS",
    detail: undefined,
    createdAt: "2026-05-03T00:00:00.000Z",
    ...overrides,
  } as unknown as import("@project-delivery/shared").TimelineEvent;
}

// -----------------------------------------------------------------------------

beforeEach(() => {
  listVersionsMock.mockReset();
  getVersionBoardViewMock.mockReset();
  listRequirementsMock.mockReset();
  listTimelineMock.mockReset();
  createVersionMock.mockReset();
  updateVersionMock.mockReset();
  routerMock.replace.mockReset();
  routerMock.push.mockReset();
  searchParamsMock.current = new URLSearchParams();
  capturedHandlers.createVersionOnCreated = null;
  capturedHandlers.editVersionOnUpdated = null;
  capturedHandlers.detailSheetOnChanged = null;
  capturedHandlers.createTaskOnCreated = null;
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "PM",
      status: "ACTIVE",
    },
  };
  // Default safe stubs — individual tests override as needed.
  listRequirementsMock.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  listTimelineMock.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
});

afterEach(() => {
  cleanup();
});

describe("VersionPage", () => {
  it("loads versions, selects the first one, and renders the hero with stats", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion({ name: "v1.0.0" })],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(
      makeBoardResponse([
        makeSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F01", title: "Login UI" }),
      ]),
    );

    render(<VersionPage />);

    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByTestId("version-hero")).toBeInTheDocument();
    // KPI cells render with stats values.
    expect(
      screen.getByTestId("version-hero-kpi-requirementCount").textContent,
    ).toContain("3");
    expect(
      screen.getByTestId("version-hero-kpi-taskCount").textContent,
    ).toContain("7");
    expect(
      screen.getByTestId("version-hero-kpi-bugCount").textContent,
    ).toContain("2");
    expect(
      screen.getByTestId("version-hero-kpi-blockedCount").textContent,
    ).toContain("1");
    // Board column with the in-progress category renders.
    expect(
      screen.getByTestId("version-board-column-IN_PROGRESS"),
    ).toBeInTheDocument();
    // Card itself surfaces.
    expect(await screen.findByText("Login UI")).toBeInTheDocument();
  });

  it("keeps the board responsive without forcing six columns on mobile", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(makeBoardResponse([]));

    render(<VersionPage />);

    const columns = await screen.findByTestId("version-board-columns");
    expect(columns.className).toContain("grid-cols-1");
    expect(columns.className).toContain("md:grid-cols-2");
    expect(columns.className).toContain("xl:grid-cols-6");
    expect(screen.getByTestId("version-board-page").className).toContain(
      "min-w-0",
    );
  });

  it("selects the version from the URL before falling back to the first one", async () => {
    searchParamsMock.current = new URLSearchParams({
      versionId: "01ARZ3NDEKTSV4RRFFQ69G5FV2",
    });
    listVersionsMock.mockResolvedValueOnce({
      items: [
        makeVersion({ id: "01ARZ3NDEKTSV4RRFFQ69G5FV1", name: "v1.0.0" }),
        makeVersion({ id: "01ARZ3NDEKTSV4RRFFQ69G5FV2", name: "v2.0.0" }),
      ],
      total: 2,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(makeBoardResponse([]));

    render(<VersionPage />);

    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledWith(
        expect.objectContaining({
          versionId: "01ARZ3NDEKTSV4RRFFQ69G5FV2",
        }),
      ),
    );
    expect(
      screen.getByTestId("version-board-version-trigger"),
    ).toHaveTextContent("v2.0.0");
  });

  it("falls back to em-dash for missing release date", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [
        makeVersion({
          releaseDate: undefined,
          targetDate: undefined,
        }),
      ],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(makeBoardResponse([]));

    render(<VersionPage />);

    expect(
      (await screen.findByTestId("version-hero-date-release")).textContent,
    ).toBe("—");
    expect(screen.getByTestId("version-hero-date-target").textContent).toBe(
      "—",
    );
  });

  it("renders the noVersion empty state when versions list is empty", async () => {
    listVersionsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<VersionPage />);

    await waitFor(() => expect(listVersionsMock).toHaveBeenCalled());
    expect(
      await screen.findByText("versionBoard.states.noVersion.title"),
    ).toBeInTheDocument();
    expect(getVersionBoardViewMock).not.toHaveBeenCalled();
  });

  it("renders the error state when listVersions rejects", async () => {
    listVersionsMock.mockRejectedValueOnce(new Error("boom"));

    render(<VersionPage />);

    expect(
      await screen.findByText("versionBoard.states.error.title"),
    ).toBeInTheDocument();
  });

  it("opens the task detail sheet when a board card is clicked", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(
      makeBoardResponse([
        makeSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F01", title: "Card open" }),
      ]),
    );

    render(<VersionPage />);

    const card = await screen.findByText("Card open");
    fireEvent.click(card);

    expect(
      await screen.findByTestId("task-detail-sheet-open"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-sheet-item-title").textContent).toBe(
      "Card open",
    );
  });

  it("refetches board, versions, and timeline when TaskDetailSheet.onChanged fires", async () => {
    listVersionsMock.mockResolvedValue({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValue(
      makeBoardResponse([
        makeSummary({ id: "01ARZ3NDEKTSV4RRFFQ69G5F02", title: "Refresh me" }),
      ]),
    );

    render(<VersionPage />);

    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledTimes(1));
    // Click the card to open the sheet, then trigger onChanged.
    fireEvent.click(await screen.findByText("Refresh me"));
    fireEvent.click(
      await screen.findByTestId("task-detail-sheet-fire-changed"),
    );

    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledTimes(2));
  });

  it("switches to the requirements tab and calls listRequirements", async () => {
    listVersionsMock.mockResolvedValue({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValue(makeBoardResponse([]));
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FRA",
          title: "Linked requirement",
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<VersionPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId("version-tab-requirements"));
    expect(await screen.findByText("Linked requirement")).toBeInTheDocument();
    expect(
      screen.getByTestId("version-requirement-row-01ARZ3NDEKTSV4RRFFQ69G5FRA"),
    ).toBeInTheDocument();
  });

  it("shows the requirements empty state when none are linked", async () => {
    listVersionsMock.mockResolvedValue({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValue(makeBoardResponse([]));
    listRequirementsMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });

    render(<VersionPage />);

    fireEvent.click(await screen.findByTestId("version-tab-requirements"));
    expect(
      await screen.findByTestId("version-tab-requirements-empty"),
    ).toBeInTheDocument();
  });

  it("switches to the timeline tab and renders events", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(makeBoardResponse([]));
    listTimelineMock.mockResolvedValueOnce({
      items: [
        makeTimelineEvent({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FT1",
          title: "version moved",
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    render(<VersionPage />);

    await waitFor(() => expect(listTimelineMock).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId("version-tab-timeline"));
    const timelineRow = await screen.findByTestId(
      "version-timeline-row-01ARZ3NDEKTSV4RRFFQ69G5FT1",
    );
    expect(timelineRow).toBeInTheDocument();
    expect(timelineRow.textContent).toContain("Alice");
    expect(timelineRow.textContent).toContain(
      "versionBoard.timeline.event.STATUS_CHANGED",
    );
  });

  it("refetches the board when a filter is applied", async () => {
    let resolveSecond: (
      value: ReturnType<typeof makeBoardResponse>,
    ) => void = () => {};
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock
      .mockResolvedValueOnce(
        makeBoardResponse([
          makeSummary({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F10",
            title: "Old filtered card",
          }),
        ]),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    render(<VersionPage />);

    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Old filtered card")).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("version-board-filter-type-BUG"));

    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.queryByText("Old filtered card")).not.toBeInTheDocument(),
    );
    const secondCallArgs = getVersionBoardViewMock.mock.calls[1]![0];
    expect(secondCallArgs).toMatchObject({ workItemType: "BUG" });

    resolveSecond(
      makeBoardResponse([
        makeSummary({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F11",
          title: "New filtered card",
          type: "BUG",
        }),
      ]),
    );
    expect(await screen.findByText("New filtered card")).toBeInTheDocument();
  });

  it("clears filters when the clear-filter button is pressed", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValue(makeBoardResponse([]));

    render(<VersionPage />);

    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(
      await screen.findByTestId("version-board-filter-type-TASK"),
    );
    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(2),
    );
    fireEvent.click(await screen.findByTestId("version-board-filter-clear"));
    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(3),
    );
    const thirdCallArgs = getVersionBoardViewMock.mock.calls[2]![0];
    expect(thirdCallArgs.workItemType).toBeUndefined();
  });

  it("opens the create-version dialog and refreshes versions on success", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion({ id: "01ARZ3NDEKTSV4RRFFQ69G5FV1" })],
      total: 1,
    });
    listVersionsMock.mockResolvedValueOnce({
      items: [
        makeVersion({ id: "01ARZ3NDEKTSV4RRFFQ69G5FV1" }),
        makeVersion({ id: "01ARZ3NDEKTSV4RRFFQ69G5FV2", name: "v2.0.0" }),
      ],
      total: 2,
    });
    getVersionBoardViewMock.mockResolvedValue(makeBoardResponse([]));

    render(<VersionPage />);

    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByTestId("version-page-new-version"));
    expect(
      await screen.findByTestId("create-version-dialog-open"),
    ).toBeInTheDocument();

    // Simulate the dialog firing its onCreated callback.
    capturedHandlers.createVersionOnCreated?.(
      makeVersion({ id: "01ARZ3NDEKTSV4RRFFQ69G5FV2", name: "v2.0.0" }),
    );
    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(2));
  });

  it("opens the edit-version dialog and refreshes versions on success", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion({ name: "v1.0.0 updated" })],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValue(makeBoardResponse([]));

    render(<VersionPage />);

    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByTestId("version-page-edit-version"));
    expect(
      await screen.findByTestId("edit-version-dialog-open"),
    ).toBeInTheDocument();

    capturedHandlers.editVersionOnUpdated?.(
      makeVersion({ name: "v1.0.0 updated" }),
    );
    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(2));
  });

  it("keeps version mutation entries read-only for VIEWER space role", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: "SPC_01",
      },
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space A",
        role: "VIEWER",
        status: "ACTIVE",
      },
    };
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(makeBoardResponse([]));

    render(<VersionPage />);

    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("version-page-new-version")).toBeDisabled();
    expect(screen.getByTestId("version-page-edit-version")).toBeDisabled();
    expect(screen.getByTestId("version-board-new-work-item")).toBeDisabled();

    fireEvent.click(screen.getByTestId("version-page-new-version"));
    fireEvent.click(screen.getByTestId("version-board-new-work-item"));

    expect(
      screen.queryByTestId("create-version-dialog-open"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("create-task-dialog-open"),
    ).not.toBeInTheDocument();
  });

  it("allows product writer roles to create work items but not versions", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: "SPC_01",
      },
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space A",
        role: "DEVELOPER",
        status: "ACTIVE",
      },
    };
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(makeBoardResponse([]));

    render(<VersionPage />);

    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("version-page-new-version")).toBeDisabled();
    expect(screen.getByTestId("version-page-edit-version")).toBeDisabled();

    const newWorkItem = screen.getByTestId("version-board-new-work-item");
    expect(newWorkItem).not.toBeDisabled();
    fireEvent.click(newWorkItem);
    expect(
      await screen.findByTestId("create-task-dialog-open"),
    ).toBeInTheDocument();
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledTimes(1));

    capturedHandlers.createTaskOnCreated?.();

    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledTimes(2));
  });

  it("renders the noSpace empty state when session lacks a space", async () => {
    sessionMock.current = {
      session: { defaultOrganizationId: "ORG_01" },
      currentSpace: null,
    };

    render(<VersionPage />);

    expect(
      await screen.findByText("versionBoard.states.noSpace.title"),
    ).toBeInTheDocument();
    expect(listVersionsMock).not.toHaveBeenCalled();
  });
});
