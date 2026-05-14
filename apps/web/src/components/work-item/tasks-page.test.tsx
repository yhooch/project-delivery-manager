import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------------
// Mock collaborator modules BEFORE importing the component under test.
// -----------------------------------------------------------------------------

// next-intl translator: return the key path back so we can assert against it.
// NOTE: useTranslations MUST return a stable function across renders, otherwise
// hooks that depend on the translator instance trigger an infinite useEffect
// loop (the real next-intl impl memoizes).
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

// next-intl/navigation re-exports used by routing — not needed but stub to avoid
// accidental imports through other modules.
vi.mock("../../i18n/routing", () => ({
  routing: { defaultLocale: "zh-CN", locales: ["zh-CN", "en-US"] },
  Link: ({ children }: { children: React.ReactNode }) => children,
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Session provider — bypass real provider entirely.
const sessionMock = vi.hoisted(() => ({
  current: {
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

// Lookups hooks — drive deterministic member/version cache resolution.
const memberMap = new Map<string, { user: { name: string; username: string } }>();
const versionMap = new Map<string, { name: string }>();
vi.mock("../../lib/v2/lookups", () => ({
  useSpaceMembers: () => ({
    members: [],
    loading: false,
    error: null,
    getMember: (id: string) => memberMap.get(id),
  }),
  useVersions: () => ({
    versions: [],
    loading: false,
    error: null,
    getVersion: (id: string) => versionMap.get(id),
  }),
}));

// Service mocks. NOTE: vi.mock is hoisted, so the mock fn must be created
// via vi.hoisted to be available when the factory runs.
const { listWorkItemsMock } = vi.hoisted(() => ({
  listWorkItemsMock: vi.fn(),
}));
vi.mock("../../lib/work-item-service", () => ({
  listWorkItems: listWorkItemsMock,
  getWorkItem: vi.fn(),
}));

// CreateTaskDialog & TaskDetailSheet — mock to inert components so we don't
// pull in unrelated Radix portal interactions while testing the list.
vi.mock("./create-task-dialog", () => ({
  CreateTaskDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-task-dialog-open" /> : null,
}));
vi.mock("./task-detail-sheet", () => ({
  TaskDetailSheet: ({
    item,
    open,
  }: {
    item: { id: string; title: string } | null;
    open: boolean;
  }) =>
    open && item ? (
      <div data-testid="task-detail-sheet-open">
        <span data-testid="task-detail-sheet-item-id">{item.id}</span>
        <span data-testid="task-detail-sheet-item-title">{item.title}</span>
      </div>
    ) : null,
}));

import { TasksPage } from "./tasks-page";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const ASSIGNEE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const VERSION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FD1";

function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    type: "TASK",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Implement login page",
    priority: "MEDIUM",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
    statusCategory: "IN_PROGRESS",
    lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
    assigneeId: ASSIGNEE_ID,
    versionId: VERSION_ID,
    ...overrides,
  } as unknown as import("@project-delivery/shared").WorkItem;
}

// -----------------------------------------------------------------------------

beforeEach(() => {
  listWorkItemsMock.mockReset();
  memberMap.clear();
  versionMap.clear();
  sessionMock.current = {
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
    status: "authenticated" as const,
  };
});

afterEach(() => {
  cleanup();
});

describe("TasksPage", () => {
  it("renders task rows with real assignee name from the member lookup", async () => {
    memberMap.set(ASSIGNEE_ID, {
      user: { name: "Alice Wonderland", username: "alice" },
    });
    versionMap.set(VERSION_ID, { name: "v1.0.0 release" });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [makeTask({ title: "Login flow" })],
      total: 1,
    });

    render(<TasksPage />);

    await waitFor(() => expect(listWorkItemsMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Login flow")).toBeInTheDocument();
    // Member name should be rendered through Avatar fallback initial — the
    // initial of the resolved name "A", not "?" or the ULID tail.
    expect(screen.getByText("v1.0.0 release")).toBeInTheDocument();
    // The avatar fallback shows the initial of the resolved name.
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("falls back to the assignee id when no member is cached", async () => {
    listWorkItemsMock.mockResolvedValueOnce({
      items: [makeTask({ title: "Untriaged" })],
      total: 1,
    });

    render(<TasksPage />);

    expect(await screen.findByText("Untriaged")).toBeInTheDocument();
    // No member lookup -> initial uses first char of the raw assignee id ("0").
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("filters tasks by status bucket when user clicks a bucket button", async () => {
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        makeTask({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
          title: "Open task",
          statusCategory: "IN_PROGRESS",
        }),
        makeTask({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
          title: "Done task",
          statusCategory: "DONE",
        }),
      ],
      total: 2,
    });

    render(<TasksPage />);

    expect(await screen.findByText("Open task")).toBeInTheDocument();
    expect(screen.getByText("Done task")).toBeInTheDocument();

    // Click on "DONE" bucket.
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems.statusCategory.DONE",
      }),
    );

    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
    expect(screen.getByText("Done task")).toBeInTheDocument();
  });

  it("opens the task detail sheet when a row is clicked", async () => {
    listWorkItemsMock.mockResolvedValueOnce({
      items: [makeTask({ title: "Click me" })],
      total: 1,
    });

    render(<TasksPage />);

    const row = await screen.findByText("Click me");
    fireEvent.click(row);

    expect(await screen.findByTestId("task-detail-sheet-open")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-sheet-item-title").textContent).toBe(
      "Click me",
    );
  });

  it("renders the empty state when there are no tasks", async () => {
    listWorkItemsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<TasksPage />);

    await waitFor(() => expect(listWorkItemsMock).toHaveBeenCalled());
    expect(await screen.findByText("tasks.states.empty.title")).toBeInTheDocument();
  });

  it("renders the error state when list call rejects", async () => {
    listWorkItemsMock.mockRejectedValueOnce(new Error("boom"));

    render(<TasksPage />);

    expect(await screen.findByText("tasks.states.error.title")).toBeInTheDocument();
  });

  it("shows the noSpace empty state when there is no current space", async () => {
    sessionMock.current = {
      currentSpace: undefined as unknown as never,
      status: "authenticated" as const,
    };

    render(<TasksPage />);

    expect(
      await screen.findByText("tasks.states.noSpace.title"),
    ).toBeInTheDocument();
    expect(listWorkItemsMock).not.toHaveBeenCalled();
  });

  it("filters by the search query (case-insensitive)", async () => {
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        makeTask({ id: "01ARZ3NDEKTSV4RRFFQ69G5F01", title: "Refactor auth" }),
        makeTask({ id: "01ARZ3NDEKTSV4RRFFQ69G5F02", title: "Polish header" }),
      ],
      total: 2,
    });

    render(<TasksPage />);

    expect(await screen.findByText("Refactor auth")).toBeInTheDocument();
    const search = screen.getByPlaceholderText("tasks.search.placeholder");
    fireEvent.change(search, { target: { value: "refactor" } });

    expect(screen.getByText("Refactor auth")).toBeInTheDocument();
    expect(screen.queryByText("Polish header")).not.toBeInTheDocument();
  });
});
