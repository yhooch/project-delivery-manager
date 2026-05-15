import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  Link: ({ children }: { children: React.ReactNode }) => children,
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/exceptions",
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
      role: "SPACE_ADMIN",
      status: "ACTIVE",
    },
  } as { session: unknown; currentSpace: unknown },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { getSpaceExceptionsViewMock } = vi.hoisted(() => ({
  getSpaceExceptionsViewMock: vi.fn(),
}));
vi.mock("../../lib/view-service", () => ({
  getSpaceExceptionsView: getSpaceExceptionsViewMock,
}));

const { getSpaceMock, updateSpaceMock } = vi.hoisted(() => ({
  getSpaceMock: vi.fn(),
  updateSpaceMock: vi.fn(),
}));
vi.mock("../../lib/space-service", () => ({
  getSpace: getSpaceMock,
  updateSpace: updateSpaceMock,
}));

vi.mock("../../lib/v2/lookups", () => ({
  useSpaceMembers: () => ({
    members: [
      {
        id: "SPM_01",
        userId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        user: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
          name: "Alice",
          username: "alice",
        },
      },
    ],
    loading: false,
    error: null,
    getMember: (userId: string) =>
      userId === "01ARZ3NDEKTSV4RRFFQ69G5FB1"
        ? {
            id: "SPM_01",
            userId,
            user: { id: userId, name: "Alice", username: "alice" },
          }
        : undefined,
  }),
  useVersions: () => ({
    versions: [{ id: "V_01", name: "Version 1" }],
    loading: false,
    error: null,
    getVersion: (versionId: string) =>
      versionId === "V_01" ? { id: "V_01", name: "Version 1" } : undefined,
  }),
}));

vi.mock("../work-item/task-detail-sheet", () => ({
  TaskDetailSheet: ({
    item,
    onChanged,
    open,
  }: {
    item: { id: string; title: string } | null;
    onChanged?: () => void;
    open: boolean;
  }) =>
    open && item ? (
      <div data-testid="task-detail-sheet-open">
        <span data-testid="task-detail-sheet-item-title">{item.title}</span>
        <button type="button" onClick={onChanged}>
          detail changed
        </button>
      </div>
    ) : null,
}));

import { ExceptionsPage } from "./exceptions-page";
import { createRecentStorageKey } from "../shell/recent-opens";

function makeWorkItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    type: "TASK",
    title: "Overdue task",
    priority: "MEDIUM",
    assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
    versionId: undefined,
    currentStatus: {
      workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
      currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
      stateCode: "IN_PROGRESS",
      stateName: "进行中",
      statusCategory: "IN_PROGRESS",
      lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
    },
    exceptionSignals: [{ type: "overdue" }],
    ...overrides,
  };
}

type TestExceptionSignal = {
  blockedReason?: string;
  dueDate?: string;
  evidenceSource?: string;
  lastStatusChangedAt?: string;
  reason?: string;
  staleDays?: number;
  staleThresholdDays?: number;
  type: string;
};

function makeException(
  workItem: ReturnType<typeof makeWorkItem>,
  type = "overdue",
): {
  exceptions: TestExceptionSignal[];
  workItem: ReturnType<typeof makeWorkItem>;
} {
  return {
    workItem,
    exceptions: [
      { type, reason: type === "blocked" ? "Waiting on API" : undefined },
    ],
  };
}

function makeViewResponse(
  items: ReturnType<typeof makeException>[],
  filters: Record<string, unknown> = { exceptionType: "overdue" },
) {
  return {
    filters: {
      organizationId: "ORG_01",
      spaceId: "SPC_01",
      ...filters,
    },
    counts: [
      {
        exceptionType: "overdue",
        count: items.filter((i) =>
          i.exceptions.some((e) => e.type === "overdue"),
        ).length,
      },
      {
        exceptionType: "blocked",
        count: items.filter((i) =>
          i.exceptions.some((e) => e.type === "blocked"),
        ).length,
      },
      { exceptionType: "pending_confirm", count: 0 },
      { exceptionType: "pending_regression", count: 0 },
      { exceptionType: "stale", count: 0 },
    ],
    items: { items, total: items.length, page: 1, pageSize: 200 },
  };
}

beforeEach(() => {
  getSpaceExceptionsViewMock.mockReset();
  routerMock.replace.mockReset();
  routerMock.push.mockReset();
  searchParamsMock.current = new URLSearchParams();
  getSpaceMock.mockReset();
  getSpaceMock.mockResolvedValue({
    id: "SPC_01",
    organizationId: "ORG_01",
    name: "Space A",
    code: "SPC-A",
    status: "ACTIVE",
    settings: { staleThresholdDays: 3 },
  });
  updateSpaceMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "SPACE_ADMIN",
      status: "ACTIVE",
    },
  };
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("ExceptionsPage", () => {
  it("consumes exceptionType and versionId from the URL and sends them to the API", async () => {
    searchParamsMock.current = new URLSearchParams({
      assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
      exceptionType: "pendingRegression",
      statusCategory: "WAITING",
      versionId: "V_01",
      workItemType: "BUG",
    });
    getSpaceExceptionsViewMock.mockResolvedValueOnce(
      makeViewResponse([], {
        exceptionType: "pending_regression",
        assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        statusCategory: "WAITING",
        versionId: "V_01",
        workItemType: "BUG",
      }),
    );

    render(<ExceptionsPage />);

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenCalledWith(
        expect.objectContaining({
          exceptionType: "pending_regression",
          assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
          statusCategory: "WAITING",
          versionId: "V_01",
          workItemType: "BUG",
          pageSize: 200,
        }),
      ),
    );
  });

  it("cleans stale versionId filters before querying exceptions", async () => {
    searchParamsMock.current = new URLSearchParams({
      exceptionType: "overdue",
      versionId: "V_OLD",
    });
    getSpaceExceptionsViewMock.mockResolvedValueOnce(
      makeViewResponse([], {
        exceptionType: "overdue",
      }),
    );

    render(<ExceptionsPage />);

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenCalledWith(
        expect.objectContaining({
          exceptionType: "overdue",
          versionId: undefined,
        }),
      ),
    );
    expect(routerMock.replace).toHaveBeenCalledWith(
      expect.not.stringContaining("versionId=V_OLD"),
      expect.objectContaining({ scroll: false }),
    );
  });

  it("renders the overdue tab with the work item title and tabs list", async () => {
    getSpaceExceptionsViewMock.mockResolvedValueOnce(
      makeViewResponse([
        makeException(
          makeWorkItem({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "Crash overdue",
          }),
        ),
      ]),
    );

    render(<ExceptionsPage />);

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Crash overdue")).toBeInTheDocument();
    // Tab triggers render with translation keys.
    expect(
      screen.getByText("m4Views.exceptionType.overdue"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("m4Views.exceptionType.blocked"),
    ).toBeInTheDocument();
  });

  it("renders the empty state on the active tab when there are no items", async () => {
    getSpaceExceptionsViewMock.mockResolvedValueOnce(makeViewResponse([]));

    render(<ExceptionsPage />);

    await waitFor(() => expect(getSpaceExceptionsViewMock).toHaveBeenCalled());
    expect(
      await screen.findByText("spaceExceptions.states.empty.title"),
    ).toBeInTheDocument();
  });

  it("renders the error state when the view fetch rejects", async () => {
    getSpaceExceptionsViewMock.mockRejectedValueOnce(new Error("nope"));

    render(<ExceptionsPage />);

    expect(
      await screen.findByText("spaceExceptions.errorTitle"),
    ).toBeInTheDocument();
  });

  it("shows the loadingList state while the view fetch is pending", async () => {
    let resolve: (
      value: ReturnType<typeof makeViewResponse>,
    ) => void = () => {};
    getSpaceExceptionsViewMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    render(<ExceptionsPage />);

    expect(
      await screen.findByText("spaceExceptions.states.loadingList"),
    ).toBeInTheDocument();

    resolve(makeViewResponse([]));
    await waitFor(() =>
      expect(
        screen.getByText("spaceExceptions.states.empty.title"),
      ).toBeInTheDocument(),
    );
  });

  it("switches to the blocked tab and renders blocked items there", async () => {
    getSpaceExceptionsViewMock.mockResolvedValueOnce(
      makeViewResponse([
        makeException(
          makeWorkItem({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "Overdue only",
            exceptionSignals: [{ type: "overdue" }],
          }),
          "overdue",
        ),
      ]),
    );
    getSpaceExceptionsViewMock.mockResolvedValueOnce(
      makeViewResponse(
        [
          makeException(
            makeWorkItem({
              id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
              title: "Blocked only",
              exceptionSignals: [{ type: "blocked", reason: "Waiting on API" }],
            }),
            "blocked",
          ),
        ],
        { exceptionType: "blocked" },
      ),
    );

    render(<ExceptionsPage />);

    expect(await screen.findByText("Overdue only")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("tab", { name: /m4Views\.exceptionType\.blocked/ }),
    );

    expect(await screen.findByText("Blocked only")).toBeInTheDocument();
    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ exceptionType: "blocked" }),
      ),
    );
    expect(routerMock.replace).toHaveBeenCalledWith(
      expect.stringContaining("exceptionType=blocked"),
      expect.objectContaining({ scroll: false }),
    );
  });

  it("syncs assignee, status, and work item type filters to the URL and API query", async () => {
    getSpaceExceptionsViewMock.mockResolvedValue(makeViewResponse([]));

    render(<ExceptionsPage />);

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(
      screen.getByTestId(
        "exceptions-filter-assigneeId-01ARZ3NDEKTSV4RRFFQ69G5FB1",
      ),
    );

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        }),
      ),
    );
    expect(routerMock.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("assigneeId=01ARZ3NDEKTSV4RRFFQ69G5FB1"),
      expect.objectContaining({ scroll: false }),
    );

    fireEvent.click(
      screen.getByTestId("exceptions-filter-statusCategory-WAITING"),
    );

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
          statusCategory: "WAITING",
        }),
      ),
    );

    fireEvent.click(screen.getByTestId("exceptions-filter-workItemType-BUG"));

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
          statusCategory: "WAITING",
          workItemType: "BUG",
        }),
      ),
    );
  });

  it("clears old exception rows while filters are reloading", async () => {
    let resolveSecond: (
      value: ReturnType<typeof makeViewResponse>,
    ) => void = () => {};
    getSpaceExceptionsViewMock
      .mockResolvedValueOnce(
        makeViewResponse([
          makeException(
            makeWorkItem({
              id: "01ARZ3NDEKTSV4RRFFQ69G5F20",
              title: "Old exception row",
            }),
          ),
        ]),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    render(<ExceptionsPage />);

    expect(await screen.findByText("Old exception row")).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(
        "exceptions-filter-assigneeId-01ARZ3NDEKTSV4RRFFQ69G5FB1",
      ),
    );

    await waitFor(() =>
      expect(screen.queryByText("Old exception row")).not.toBeInTheDocument(),
    );

    resolveSecond(
      makeViewResponse([
        makeException(
          makeWorkItem({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F21",
            title: "New exception row",
          }),
        ),
      ]),
    );

    expect(await screen.findByText("New exception row")).toBeInTheDocument();
  });

  it("renders stale and evidence metadata for exception rows", async () => {
    getSpaceExceptionsViewMock.mockResolvedValueOnce(
      makeViewResponse(
        [
          {
            workItem: makeWorkItem({
              id: "01ARZ3NDEKTSV4RRFFQ69G5F09",
              title: "Stale with metadata",
              exceptionSignals: [
                {
                  type: "stale",
                  reason: "No status change",
                  evidenceSource: "LAST_STATUS_CHANGED_AT",
                  staleDays: 8,
                  staleThresholdDays: 3,
                  lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
                },
              ],
            }),
            exceptions: [
              {
                type: "stale",
                reason: "No status change",
                evidenceSource: "LAST_STATUS_CHANGED_AT",
                staleDays: 8,
                staleThresholdDays: 3,
                lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
              },
            ],
          },
        ],
        { exceptionType: "stale" },
      ),
    );
    searchParamsMock.current = new URLSearchParams({
      exceptionType: "stale",
    });

    render(<ExceptionsPage />);

    expect(await screen.findByText("Stale with metadata")).toBeInTheDocument();
    expect(
      screen.getByText(/spaceExceptions\.list\.staleMeta/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/spaceExceptions\.list\.sourceMeta/),
    ).toBeInTheDocument();
  });

  it("opens the task detail sheet when an exception row is clicked", async () => {
    getSpaceExceptionsViewMock.mockResolvedValueOnce(
      makeViewResponse([
        makeException(
          makeWorkItem({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "Click exception",
          }),
        ),
      ]),
    );

    render(<ExceptionsPage />);

    const row = await screen.findByText("Click exception");
    fireEvent.click(row);

    expect(row.closest("button")).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByTestId("task-detail-sheet-open"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-sheet-item-title").textContent).toBe(
      "Click exception",
    );
  });

  it("records exception row opens and refetches when detail changes", async () => {
    getSpaceExceptionsViewMock
      .mockResolvedValueOnce(
        makeViewResponse([
          makeException(
            makeWorkItem({
              id: "01ARZ3NDEKTSV4RRFFQ69G5FRC",
              title: "Remember exception",
            }),
          ),
        ]),
      )
      .mockResolvedValueOnce(makeViewResponse([]));

    render(<ExceptionsPage />);

    fireEvent.click(await screen.findByText("Remember exception"));

    const stored = JSON.parse(
      window.localStorage.getItem(
        createRecentStorageKey({
          organizationId: "ORG_01",
          spaceId: "SPC_01",
        }),
      ) ?? "[]",
    ) as Array<{ href: string; title: string; type: string }>;
    expect(stored[0]).toMatchObject({
      href: "/work-items",
      title: "Remember exception",
      type: "TASK",
    });

    fireEvent.click(screen.getByRole("button", { name: "detail changed" }));

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenCalledTimes(2),
    );
  });

  it("renders the unauthenticated empty state when there is no session", async () => {
    sessionMock.current = { session: null, currentSpace: undefined };

    render(<ExceptionsPage />);

    expect(
      await screen.findByText("spaceExceptions.states.unauthenticated.title"),
    ).toBeInTheDocument();
    expect(getSpaceExceptionsViewMock).not.toHaveBeenCalled();
  });

  it("renders the noSpaceSelected empty state when session has no spaceId", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: undefined,
      },
      currentSpace: undefined,
    };

    render(<ExceptionsPage />);

    expect(
      await screen.findByText("spaceExceptions.states.noSpaceSelected.title"),
    ).toBeInTheDocument();
    expect(getSpaceExceptionsViewMock).not.toHaveBeenCalled();
  });

  it("opens the threshold dialog and saves a new value, refetching the view", async () => {
    getSpaceExceptionsViewMock.mockResolvedValue(makeViewResponse([]));
    updateSpaceMock.mockResolvedValueOnce({
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      code: "SPC-A",
      status: "ACTIVE",
      settings: { staleThresholdDays: 7 },
    });

    render(<ExceptionsPage />);

    const button = await screen.findByTestId("exceptions-threshold-button");
    await waitFor(() => expect(button).not.toBeDisabled());
    const initialFetchCalls = getSpaceExceptionsViewMock.mock.calls.length;
    fireEvent.click(button);

    const input = await screen.findByTestId(
      "exceptions-threshold-dialog-input",
    );
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(screen.getByTestId("exceptions-threshold-dialog-submit"));

    await waitFor(() => expect(updateSpaceMock).toHaveBeenCalledTimes(1));
    expect(updateSpaceMock).toHaveBeenCalledWith("SPC_01", {
      staleThresholdDays: 7,
    });
    await waitFor(() =>
      expect(getSpaceExceptionsViewMock.mock.calls.length).toBeGreaterThan(
        initialFetchCalls,
      ),
    );
  });

  it("rejects non-integer threshold values in the dialog", async () => {
    getSpaceExceptionsViewMock.mockResolvedValue(makeViewResponse([]));

    render(<ExceptionsPage />);

    const button = await screen.findByTestId("exceptions-threshold-button");
    fireEvent.click(button);

    const input = await screen.findByTestId(
      "exceptions-threshold-dialog-input",
    );
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.click(screen.getByTestId("exceptions-threshold-dialog-submit"));

    expect(
      await screen.findByText("spaceExceptions.threshold.field.error"),
    ).toBeInTheDocument();
    expect(updateSpaceMock).not.toHaveBeenCalled();
  });

  it("disables the threshold button when the current space role cannot manage", async () => {
    sessionMock.current.currentSpace = {
      ...(sessionMock.current.currentSpace as { role: string }),
      role: "DEVELOPER",
    };
    getSpaceExceptionsViewMock.mockResolvedValueOnce(makeViewResponse([]));

    render(<ExceptionsPage />);

    const button = await screen.findByTestId("exceptions-threshold-button");
    expect(button).toBeDisabled();
  });

  it("disables threshold configuration and shows an error when threshold loading fails", async () => {
    getSpaceMock.mockRejectedValueOnce(new Error("load failed"));
    getSpaceExceptionsViewMock.mockResolvedValueOnce(makeViewResponse([]));

    render(<ExceptionsPage />);

    const button = await screen.findByTestId("exceptions-threshold-button");
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      await screen.findByTestId("exceptions-threshold-error"),
    ).toHaveTextContent("errors.api.UNKNOWN");
  });
});
