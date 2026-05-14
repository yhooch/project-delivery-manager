import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { listVersionsMock, getVersionBoardViewMock } = vi.hoisted(() => ({
  listVersionsMock: vi.fn(),
  getVersionBoardViewMock: vi.fn(),
}));
vi.mock("../../lib/version-service", () => ({
  listVersions: listVersionsMock,
}));
vi.mock("../../lib/view-service", () => ({
  getVersionBoardView: getVersionBoardViewMock,
}));

// Inert dialogs/sheets so Radix portals stay quiet.
vi.mock("../work-item/create-task-dialog", () => ({
  CreateTaskDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-task-dialog-open" /> : null,
}));
vi.mock("../work-item/task-detail-sheet", () => ({
  TaskDetailSheet: ({
    item,
    open,
  }: {
    item: { id: string; title: string } | null;
    open: boolean;
  }) =>
    open && item ? (
      <div data-testid="task-detail-sheet-open">
        <span data-testid="task-detail-sheet-item-title">{item.title}</span>
      </div>
    ) : null,
}));

import { VersionBoard } from "./version-board";

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    name: "v1.0.0",
    status: "ACTIVE",
    ...overrides,
  } as unknown as import("@project-delivery/shared").Version;
}

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    type: "TASK",
    title: "Login work item",
    priority: "MEDIUM",
    assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
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
      {
        statusCategory: "DONE",
        total: items.filter((i) => i.currentStatus.statusCategory === "DONE")
          .length,
      },
      { statusCategory: "TERMINATED", total: 0 },
    ],
    items: { items, total: items.length, page: 1, pageSize: 200 },
  };
}

beforeEach(() => {
  listVersionsMock.mockReset();
  getVersionBoardViewMock.mockReset();
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

describe("VersionBoard", () => {
  it("loads the first version automatically and renders board cards", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion({ name: "v1.0.0" })],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(
      makeBoardResponse([
        makeSummary({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
          title: "Login UI",
        }),
      ]),
    );

    render(<VersionBoard />);

    await waitFor(() => expect(listVersionsMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Login UI")).toBeInTheDocument();
    // Each column header renders.
    expect(
      screen.getByText("versionBoard.columns.IN_PROGRESS"),
    ).toBeInTheDocument();
  });

  it("renders the noVersion empty state when versions list is empty", async () => {
    listVersionsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<VersionBoard />);

    await waitFor(() => expect(listVersionsMock).toHaveBeenCalled());
    expect(
      await screen.findByText("versionBoard.states.noVersion.title"),
    ).toBeInTheDocument();
    expect(getVersionBoardViewMock).not.toHaveBeenCalled();
  });

  it("renders the error state when listVersions rejects", async () => {
    listVersionsMock.mockRejectedValueOnce(new Error("boom"));

    render(<VersionBoard />);

    expect(
      await screen.findByText("versionBoard.states.error.title"),
    ).toBeInTheDocument();
  });

  it("shows the loading-versions state while listVersions is pending", async () => {
    let resolve: (value: { items: unknown[]; total: number }) => void = () => {};
    listVersionsMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    render(<VersionBoard />);

    expect(
      await screen.findByText("versionBoard.states.loadingVersions"),
    ).toBeInTheDocument();

    resolve({ items: [], total: 0 });
    await waitFor(() =>
      expect(
        screen.getByText("versionBoard.states.noVersion.title"),
      ).toBeInTheDocument(),
    );
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

    render(<VersionBoard />);

    const card = await screen.findByText("Card open");
    fireEvent.click(card);

    expect(
      await screen.findByTestId("task-detail-sheet-open"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("task-detail-sheet-item-title").textContent,
    ).toBe("Card open");
  });

  it("opens the create dialog when the column add button is clicked", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      total: 1,
    });
    getVersionBoardViewMock.mockResolvedValueOnce(makeBoardResponse([]));

    render(<VersionBoard />);

    await waitFor(() =>
      expect(getVersionBoardViewMock).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(
      screen.getByTestId("version-board-column-add-IN_PROGRESS"),
    );

    expect(
      await screen.findByTestId("create-task-dialog-open"),
    ).toBeInTheDocument();
  });
});
