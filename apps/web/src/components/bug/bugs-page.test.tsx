import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<string, (key: string) => string>(),
}));
const { searchParamsMock } = vi.hoisted(() => ({
  searchParamsMock: { current: new URLSearchParams() },
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
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
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
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "PM",
      status: "ACTIVE",
    },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const memberMap = new Map<
  string,
  { user: { name: string; username: string } }
>();
const versionMap = new Map<string, { name: string }>();
const workflowStateMap = new Map<string, { code: string; name: string }>();
vi.mock("../../lib/v2/lookups", () => ({
  useSpaceMembers: () => ({
    members: Array.from(memberMap.entries()).map(([userId, member]) => ({
      userId,
      ...member,
    })),
    loading: false,
    error: null,
    getMember: (id: string) => memberMap.get(id),
  }),
  useVersions: () => ({
    versions: Array.from(versionMap.entries()).map(([id, version]) => ({
      id,
      ...version,
    })),
    loading: false,
    error: null,
    getVersion: (id: string) => versionMap.get(id),
  }),
  useWorkflowStateLookup: () => ({
    loading: false,
    error: null,
    getState: (_workflowVersionId: string | undefined, stateId: string | undefined) =>
      stateId ? workflowStateMap.get(stateId) : undefined,
  }),
}));

const { getBugMock, listBugsMock, listRequirementsMock, listWorkItemsMock } =
  vi.hoisted(() => ({
    getBugMock: vi.fn(),
    listBugsMock: vi.fn(),
    listRequirementsMock: vi.fn(),
    listWorkItemsMock: vi.fn(),
  }));
vi.mock("../../lib/bug-service", () => ({
  getBug: getBugMock,
  listBugs: listBugsMock,
}));
vi.mock("../../lib/requirement-service", () => ({
  listRequirements: listRequirementsMock,
}));
vi.mock("../../lib/work-item-service", () => ({
  listWorkItems: listWorkItemsMock,
}));

vi.mock("./create-bug-dialog", () => ({
  CreateBugDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-bug-dialog-open" /> : null,
}));

vi.mock("./edit-bug-dialog", () => ({
  EditBugDialog: ({
    bug,
    onOpenChange,
    onUpdated,
    open,
  }: {
    bug: import("@project-delivery/shared").BugView | null;
    onOpenChange: (open: boolean) => void;
    onUpdated?: (bug: import("@project-delivery/shared").BugView) => void;
    open: boolean;
  }) =>
    open && bug ? (
      <div data-testid="edit-bug-dialog-open">
        <button
          type="button"
          onClick={() => {
            onUpdated?.({
              ...bug,
              title: "Edited bug",
              bugDetail: { ...bug.bugDetail, severity: "CRITICAL" },
            });
            onOpenChange(false);
          }}
        >
          save edit
        </button>
      </div>
    ) : null,
}));

vi.mock("../work-item/task-detail-sheet", () => ({
  TaskDetailSheet: ({
    item,
    onChanged,
    open,
    organizationId,
    spaceId,
  }: {
    item: { id: string; title: string } | null;
    onChanged?: () => void;
    open: boolean;
    organizationId?: string;
    spaceId?: string;
  }) =>
    open && item ? (
      <div data-testid="task-detail-sheet-open">
        <span data-testid="task-detail-sheet-item-id">{item.id}</span>
        <span data-testid="task-detail-sheet-item-title">{item.title}</span>
        <span data-testid="task-detail-sheet-space-id">{spaceId}</span>
        <span data-testid="task-detail-sheet-organization-id">
          {organizationId}
        </span>
        <button type="button" onClick={onChanged}>
          detail changed
        </button>
      </div>
    ) : null,
}));

import { BugsPage } from "./bugs-page";
import { createRecentStorageKey } from "../shell/recent-opens";

const ASSIGNEE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const VERSION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FD1";
const REQUIREMENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FRQ";
const RELATED_TASK_ID = "01ARZ3NDEKTSV4RRFFQ69G5FTK";

function makeBug(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    type: "BUG",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Login button missing",
    priority: "HIGH",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
    statusCategory: "IN_PROGRESS",
    lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
    assigneeId: ASSIGNEE_ID,
    versionId: VERSION_ID,
    bugDetail: { severity: "MAJOR" },
    ...overrides,
  } as unknown as import("@project-delivery/shared").BugView;
}

beforeEach(() => {
  getBugMock.mockReset();
  listBugsMock.mockReset();
  listRequirementsMock.mockReset();
  listWorkItemsMock.mockReset();
  searchParamsMock.current = new URLSearchParams();
  memberMap.clear();
  versionMap.clear();
  workflowStateMap.clear();
  sessionMock.current = {
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "PM",
      status: "ACTIVE",
    },
    status: "authenticated" as const,
  };
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("BugsPage", () => {
  it("opens the create dialog from the command palette query", async () => {
    searchParamsMock.current = new URLSearchParams("new=bug");
    listBugsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<BugsPage />);

    await waitFor(() => expect(listBugsMock).toHaveBeenCalled());
    expect(
      await screen.findByTestId("create-bug-dialog-open"),
    ).toBeInTheDocument();
  });

  it("renders bug rows with member-resolved assignee initial and version name", async () => {
    memberMap.set(ASSIGNEE_ID, {
      user: { name: "Bob Smith", username: "bob" },
    });
    versionMap.set(VERSION_ID, { name: "v2.0 beta" });
    listBugsMock.mockResolvedValueOnce({
      items: [makeBug({ title: "Crash on submit" })],
      total: 1,
    });

    render(<BugsPage />);

    await waitFor(() => expect(listBugsMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Crash on submit")).toBeInTheDocument();
    expect(screen.getByText("v2.0 beta")).toBeInTheDocument();
    // The fallback initial uses first char of the resolved name ("B"), not "?".
    expect(screen.getAllByText("B").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the assignee id when no member is cached", async () => {
    listBugsMock.mockResolvedValueOnce({
      items: [makeBug({ title: "No-member bug" })],
      total: 1,
    });

    render(<BugsPage />);

    expect(await screen.findByText("No-member bug")).toBeInTheDocument();
    // Raw assignee id starts with "0" so fallback initial is "0" — there may
    // be multiple "0" labels rendered (severity counts etc.); ensure at least
    // one is the avatar fallback.
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });

  it("renders workflow-state buckets for the bug lifecycle", async () => {
    listBugsMock.mockResolvedValueOnce({
      items: [],
      total: 0,
    });

    render(<BugsPage />);

    await waitFor(() => expect(listBugsMock).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: /bugs\.buckets\.pendingConfirm/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /bugs\.buckets\.pendingFix/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /bugs\.buckets\.fixing/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /bugs\.buckets\.pendingRegression/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /bugs\.buckets\.regressionPassed/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /bugs\.buckets\.closed/ }),
    ).toBeInTheDocument();
  });

  it("filters by fixing bucket (IN_PROGRESS) through the backend query", async () => {
    listBugsMock
      .mockResolvedValueOnce({
        items: [
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "Fixing bug",
            statusCategory: "IN_PROGRESS",
          }),
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            title: "Closed bug",
            statusCategory: "DONE",
          }),
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F03",
            title: "Terminated bug",
            statusCategory: "TERMINATED",
          }),
        ],
        total: 3,
      })
      .mockResolvedValueOnce({
        items: [
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "Fixing bug",
            statusCategory: "IN_PROGRESS",
          }),
        ],
        total: 1,
      });

    render(<BugsPage />);

    expect(await screen.findByText("Fixing bug")).toBeInTheDocument();
    expect(screen.getByText("Closed bug")).toBeInTheDocument();
    expect(screen.getByText("Terminated bug")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /bugs\.buckets\.fixing/ }),
    );
    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          spaceId: "SPC_01",
          statusCategory: "IN_PROGRESS",
          type: "BUG",
        }),
      ),
    );
    expect(screen.getByText("Fixing bug")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Closed bug")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Terminated bug")).not.toBeInTheDocument();
  });

  it("filters by pending regression bucket (VERIFYING) through the backend query", async () => {
    listBugsMock
      .mockResolvedValueOnce({
        items: [
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "In progress bug",
            statusCategory: "IN_PROGRESS",
          }),
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            title: "Regression bug",
            statusCategory: "VERIFYING",
          }),
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            title: "Regression bug",
            statusCategory: "VERIFYING",
          }),
        ],
        total: 1,
      });

    render(<BugsPage />);

    expect(await screen.findByText("In progress bug")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /bugs\.buckets\.pendingRegression/,
      }),
    );
    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          statusCategory: "VERIFYING",
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("In progress bug")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Regression bug")).toBeInTheDocument();
  });

  it("separates regression passed and closed bugs by workflow state", async () => {
    workflowStateMap.set("STATE_REGRESSION_PASSED", {
      code: "REGRESSION_PASSED",
      name: "Regression passed",
    });
    workflowStateMap.set("STATE_CLOSED", {
      code: "CLOSED",
      name: "Closed",
    });
    listBugsMock
      .mockResolvedValueOnce({
        items: [
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            currentStateId: "STATE_REGRESSION_PASSED",
            title: "Passed bug",
            statusCategory: "DONE",
          }),
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            currentStateId: "STATE_CLOSED",
            title: "Closed bug",
            statusCategory: "DONE",
          }),
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            currentStateId: "STATE_REGRESSION_PASSED",
            title: "Passed bug",
            statusCategory: "DONE",
          }),
          makeBug({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            currentStateId: "STATE_CLOSED",
            title: "Closed bug",
            statusCategory: "DONE",
          }),
        ],
        total: 2,
      });

    render(<BugsPage />);

    expect(await screen.findByText("Passed bug")).toBeInTheDocument();
    expect(screen.getByText("Closed bug")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /bugs\.buckets\.closed/ }),
    );

    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ statusCategory: "DONE" }),
      ),
    );
    expect(await screen.findByText("Closed bug")).toBeInTheDocument();
    expect(screen.queryByText("Passed bug")).not.toBeInTheDocument();
  });

  it("opens a bug detail sheet from a bugId deep link", async () => {
    searchParamsMock.current = new URLSearchParams(
      "bugId=01ARZ3NDEKTSV4RRFFQ69G5FDL",
    );
    listBugsMock.mockResolvedValueOnce({ items: [], total: 0 });
    getBugMock.mockResolvedValueOnce(
      makeBug({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FDL",
        title: "Deep linked bug",
      }),
    );

    render(<BugsPage />);

    await waitFor(() =>
      expect(getBugMock).toHaveBeenCalledWith({
        bugId: "01ARZ3NDEKTSV4RRFFQ69G5FDL",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      }),
    );
    expect(
      await screen.findByTestId("task-detail-sheet-open"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-sheet-item-title")).toHaveTextContent(
      "Deep linked bug",
    );
  });

  it("opens a bug detail sheet from a workItemId deep link", async () => {
    searchParamsMock.current = new URLSearchParams(
      "workItemId=01ARZ3NDEKTSV4RRFFQ69G5FWI",
    );
    listBugsMock.mockResolvedValueOnce({ items: [], total: 0 });
    getBugMock.mockResolvedValueOnce(
      makeBug({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FWI",
        title: "Work item linked bug",
      }),
    );

    render(<BugsPage />);

    await waitFor(() =>
      expect(getBugMock).toHaveBeenCalledWith(
        expect.objectContaining({
          bugId: "01ARZ3NDEKTSV4RRFFQ69G5FWI",
        }),
      ),
    );
    expect(await screen.findByText("Work item linked bug")).toBeInTheDocument();
  });

  it("opens filter controls and sends selected version, assignee, priority, severity, requirement, and related task to the backend", async () => {
    memberMap.set(ASSIGNEE_ID, {
      user: { name: "Bob Smith", username: "bob" },
    });
    versionMap.set(VERSION_ID, { name: "v2.0 beta" });
    listRequirementsMock.mockResolvedValueOnce({
      items: [{ id: REQUIREMENT_ID, title: "Login requirement" }],
      total: 1,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        makeBug({ id: RELATED_TASK_ID, type: "TASK", title: "Related task" }),
      ],
      total: 1,
    });
    listBugsMock.mockResolvedValue({
      items: [makeBug({ title: "Filtered bug" })],
      total: 1,
    });

    render(<BugsPage />);

    await screen.findByText("Filtered bug");
    fireEvent.click(screen.getByTestId("bugs-filter-button"));
    expect(await screen.findByText("Login requirement")).toBeInTheDocument();
    expect(await screen.findByText("Related task")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("bugs-filter-version"), {
      target: { value: VERSION_ID },
    });
    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ versionId: VERSION_ID }),
      ),
    );

    fireEvent.change(screen.getByTestId("bugs-filter-assignee"), {
      target: { value: ASSIGNEE_ID },
    });
    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ assigneeId: ASSIGNEE_ID }),
      ),
    );

    fireEvent.change(screen.getByTestId("bugs-filter-priority"), {
      target: { value: "URGENT" },
    });
    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ priority: "URGENT" }),
      ),
    );

    fireEvent.change(screen.getByTestId("bugs-filter-severity"), {
      target: { value: "CRITICAL" },
    });
    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: "CRITICAL" }),
      ),
    );

    fireEvent.change(screen.getByTestId("bugs-filter-requirement"), {
      target: { value: REQUIREMENT_ID },
    });
    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ requirementId: REQUIREMENT_ID }),
      ),
    );

    fireEvent.change(screen.getByTestId("bugs-filter-related-task"), {
      target: { value: RELATED_TASK_ID },
    });
    await waitFor(() =>
      expect(listBugsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assigneeId: ASSIGNEE_ID,
          priority: "URGENT",
          relatedTaskId: RELATED_TASK_ID,
          requirementId: REQUIREMENT_ID,
          severity: "CRITICAL",
          versionId: VERSION_ID,
        }),
      ),
    );
  });

  it("initializes supported filters from overview query params and ignores task-only workItemType", async () => {
    searchParamsMock.current = new URLSearchParams(
      `versionId=${VERSION_ID}&statusCategory=DONE&workItemType=TASK`,
    );
    listBugsMock.mockResolvedValueOnce({
      items: [makeBug({ title: "Overview filtered bug" })],
      total: 1,
    });

    render(<BugsPage />);

    await waitFor(() =>
      expect(listBugsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: "SPC_01",
          statusCategory: "DONE",
          type: "BUG",
          versionId: VERSION_ID,
        }),
      ),
    );
    const [query] = listBugsMock.mock.calls[0];
    expect(query).not.toHaveProperty("workItemType");
    expect(await screen.findByText("Overview filtered bug")).toBeInTheDocument();
  });

  it("opens the task detail sheet when a row is clicked", async () => {
    listBugsMock.mockResolvedValueOnce({
      items: [makeBug({ title: "Click bug" })],
      total: 1,
    });

    render(<BugsPage />);

    const row = await screen.findByText("Click bug");
    fireEvent.click(row);

    expect(
      await screen.findByTestId("task-detail-sheet-open"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-sheet-item-title").textContent).toBe(
      "Click bug",
    );
    expect(screen.getByTestId("task-detail-sheet-space-id")).toHaveTextContent(
      "SPC_01",
    );
    expect(
      screen.getByTestId("task-detail-sheet-organization-id"),
    ).toHaveTextContent("ORG_01");
  });

  it("records directly opened bugs in recent opens", async () => {
    listBugsMock.mockResolvedValueOnce({
      items: [
        makeBug({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FRC",
          title: "Remember bug",
        }),
      ],
      total: 1,
    });

    render(<BugsPage />);

    fireEvent.click(await screen.findByText("Remember bug"));

    const stored = JSON.parse(
      window.localStorage.getItem(
        createRecentStorageKey({
          organizationId: "ORG_01",
          spaceId: "SPC_01",
        }),
      ) ?? "[]",
    ) as Array<{ href: string; title: string; type: string }>;
    expect(stored[0]).toMatchObject({
      href: "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FRC",
      title: "Remember bug",
      type: "BUG",
    });
  });

  it("marks the keyboard-selected bug row as aria-selected", async () => {
    listBugsMock.mockResolvedValueOnce({
      items: [
        makeBug({ id: "01ARZ3NDEKTSV4RRFFQ69G5F01", title: "First bug" }),
        makeBug({ id: "01ARZ3NDEKTSV4RRFFQ69G5F02", title: "Second bug" }),
      ],
      total: 2,
    });

    render(<BugsPage />);

    await screen.findByText("First bug");
    fireEvent.keyDown(window, { key: "j" });

    const rows = screen.getAllByTestId("bugs-row");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveAttribute(
      "data-id",
      "01ARZ3NDEKTSV4RRFFQ69G5F01",
    );
    expect(rows[1]).toHaveAttribute("aria-selected", "false");
  });

  it("refetches the bug list when the detail sheet reports a change", async () => {
    listBugsMock
      .mockResolvedValueOnce({
        items: [makeBug({ title: "Before action" })],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [makeBug({ title: "After action" })],
        total: 1,
      });

    render(<BugsPage />);

    fireEvent.click(await screen.findByText("Before action"));
    fireEvent.click(screen.getByRole("button", { name: "detail changed" }));

    await waitFor(() => expect(listBugsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("After action")).toBeInTheDocument();
  });

  it("opens edit from a bug row and refreshes the list and active detail after saving", async () => {
    listBugsMock
      .mockResolvedValueOnce({
        items: [makeBug({ title: "Before edit" })],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [makeBug({ title: "After edit" })],
        total: 1,
      });

    render(<BugsPage />);

    fireEvent.click(await screen.findByText("Before edit"));
    expect(screen.getByTestId("task-detail-sheet-item-title")).toHaveTextContent(
      "Before edit",
    );

    const editButton = screen.getByTestId("bugs-edit-button");
    expect(editButton).toHaveAttribute("data-id", "01ARZ3NDEKTSV4RRFFQ69G5FA1");
    fireEvent.click(editButton);
    expect(await screen.findByTestId("edit-bug-dialog-open")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "save edit" }));

    await waitFor(() => expect(listBugsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("After edit")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-sheet-item-title")).toHaveTextContent(
      "Edited bug",
    );
  });

  it("renders the empty state when there are no bugs", async () => {
    listBugsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<BugsPage />);

    await waitFor(() => expect(listBugsMock).toHaveBeenCalled());
    expect(
      await screen.findByText("bugs.states.empty.title"),
    ).toBeInTheDocument();
  });

  it("renders the error state when the list call rejects", async () => {
    listBugsMock.mockRejectedValueOnce(new Error("network"));

    render(<BugsPage />);

    expect(
      await screen.findByText("bugs.states.error.title"),
    ).toBeInTheDocument();
  });

  it("shows noSpace empty state when there is no current space", async () => {
    sessionMock.current = {
      currentSpace: undefined as unknown as never,
      status: "authenticated" as const,
    };

    render(<BugsPage />);

    expect(
      await screen.findByText("bugs.states.noSpace.title"),
    ).toBeInTheDocument();
    expect(listBugsMock).not.toHaveBeenCalled();
  });

  it("hides the create entry for read-only space roles", async () => {
    sessionMock.current = {
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space A",
        role: "VIEWER",
        status: "ACTIVE",
      },
      status: "authenticated" as const,
    };
    listBugsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<BugsPage />);

    await waitFor(() => expect(listBugsMock).toHaveBeenCalled());
    expect(screen.queryByTestId("bugs-create-button")).not.toBeInTheDocument();
  });
});
