import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function makeException(workItem: ReturnType<typeof makeWorkItem>, type = "overdue") {
  return {
    workItem,
    exceptions: [{ type, reason: type === "blocked" ? "Waiting on API" : undefined }],
  };
}

function makeViewResponse(items: ReturnType<typeof makeException>[]) {
  return {
    counts: [
      { exceptionType: "overdue", count: items.filter((i) => i.exceptions.some((e) => e.type === "overdue")).length },
      { exceptionType: "blocked", count: items.filter((i) => i.exceptions.some((e) => e.type === "blocked")).length },
      { exceptionType: "pending_confirm", count: 0 },
      { exceptionType: "pending_regression", count: 0 },
      { exceptionType: "stale", count: 0 },
    ],
    items: { items, total: items.length, page: 1, pageSize: 100 },
  };
}

beforeEach(() => {
  getSpaceExceptionsViewMock.mockReset();
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
  it("renders the overdue tab with the work item title and tabs list", async () => {
    getSpaceExceptionsViewMock.mockResolvedValueOnce(
      makeViewResponse([
        makeException(makeWorkItem({ id: "01ARZ3NDEKTSV4RRFFQ69G5F01", title: "Crash overdue" })),
      ]),
    );

    render(<ExceptionsPage />);

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Crash overdue")).toBeInTheDocument();
    // Tab triggers render with translation keys.
    expect(screen.getByText("m4Views.exceptionType.overdue")).toBeInTheDocument();
    expect(screen.getByText("m4Views.exceptionType.blocked")).toBeInTheDocument();
  });

  it("renders the empty state on the active tab when there are no items", async () => {
    getSpaceExceptionsViewMock.mockResolvedValueOnce(makeViewResponse([]));

    render(<ExceptionsPage />);

    await waitFor(() =>
      expect(getSpaceExceptionsViewMock).toHaveBeenCalled(),
    );
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
    let resolve: (value: ReturnType<typeof makeViewResponse>) => void = () => {};
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
        makeException(
          makeWorkItem({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            title: "Blocked only",
            exceptionSignals: [{ type: "blocked", reason: "Waiting on API" }],
          }),
          "blocked",
        ),
      ]),
    );

    render(<ExceptionsPage />);

    expect(await screen.findByText("Overdue only")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("tab", { name: /m4Views\.exceptionType\.blocked/ }),
    );

    expect(await screen.findByText("Blocked only")).toBeInTheDocument();
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

    expect(
      await screen.findByTestId("task-detail-sheet-open"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("task-detail-sheet-item-title").textContent,
    ).toBe("Click exception");
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
    fireEvent.click(
      screen.getByTestId("exceptions-threshold-dialog-submit"),
    );

    await waitFor(() => expect(updateSpaceMock).toHaveBeenCalledTimes(1));
    expect(updateSpaceMock).toHaveBeenCalledWith("SPC_01", {
      staleThresholdDays: 7,
    });
    await waitFor(() =>
      expect(
        getSpaceExceptionsViewMock.mock.calls.length,
      ).toBeGreaterThan(initialFetchCalls),
    );
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
});
