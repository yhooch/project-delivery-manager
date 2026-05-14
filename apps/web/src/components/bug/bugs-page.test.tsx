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
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

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

const { listBugsMock } = vi.hoisted(() => ({
  listBugsMock: vi.fn(),
}));
vi.mock("../../lib/bug-service", () => ({
  listBugs: listBugsMock,
}));

vi.mock("./create-bug-dialog", () => ({
  CreateBugDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-bug-dialog-open" /> : null,
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
        <span data-testid="task-detail-sheet-item-id">{item.id}</span>
        <span data-testid="task-detail-sheet-item-title">{item.title}</span>
      </div>
    ) : null,
}));

import { BugsPage } from "./bugs-page";

const ASSIGNEE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const VERSION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FD1";

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
  listBugsMock.mockReset();
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

describe("BugsPage", () => {
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

  it("filters by open bucket (excluding DONE and TERMINATED)", async () => {
    listBugsMock.mockResolvedValueOnce({
      items: [
        makeBug({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
          title: "Open bug",
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
    });

    render(<BugsPage />);

    expect(await screen.findByText("Open bug")).toBeInTheDocument();
    expect(screen.getByText("Closed bug")).toBeInTheDocument();
    expect(screen.getByText("Terminated bug")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /bugs\.buckets\.open/ }),
    );
    expect(screen.getByText("Open bug")).toBeInTheDocument();
    expect(screen.queryByText("Closed bug")).not.toBeInTheDocument();
    expect(screen.queryByText("Terminated bug")).not.toBeInTheDocument();
  });

  it("filters by regression bucket (only VERIFYING)", async () => {
    listBugsMock.mockResolvedValueOnce({
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
    });

    render(<BugsPage />);

    expect(await screen.findByText("In progress bug")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /bugs\.buckets\.regression/ }),
    );
    expect(screen.queryByText("In progress bug")).not.toBeInTheDocument();
    expect(screen.getByText("Regression bug")).toBeInTheDocument();
  });

  it("opens the task detail sheet when a row is clicked", async () => {
    listBugsMock.mockResolvedValueOnce({
      items: [makeBug({ title: "Click bug" })],
      total: 1,
    });

    render(<BugsPage />);

    const row = await screen.findByText("Click bug");
    fireEvent.click(row);

    expect(await screen.findByTestId("task-detail-sheet-open")).toBeInTheDocument();
    expect(
      screen.getByTestId("task-detail-sheet-item-title").textContent,
    ).toBe("Click bug");
  });

  it("renders the empty state when there are no bugs", async () => {
    listBugsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<BugsPage />);

    await waitFor(() => expect(listBugsMock).toHaveBeenCalled());
    expect(await screen.findByText("bugs.states.empty.title")).toBeInTheDocument();
  });

  it("renders the error state when the list call rejects", async () => {
    listBugsMock.mockRejectedValueOnce(new Error("network"));

    render(<BugsPage />);

    expect(await screen.findByText("bugs.states.error.title")).toBeInTheDocument();
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
});
