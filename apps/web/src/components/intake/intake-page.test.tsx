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

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<
    string,
    (key: string, values?: Record<string, unknown>) => string
  >(),
}));
const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}));
const { searchParamsMock } = vi.hoisted(() => ({
  searchParamsMock: { current: new URLSearchParams() },
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string, values?: Record<string, unknown>) => {
        if (namespace === "intakeItems" && k === "relatedTasks.meta") {
          return `${values?.dueDate ?? ""} · ${values?.priority ?? ""} · ${
            values?.status ?? ""
          }`;
        }
        return namespace ? `${namespace}.${k}` : k;
      };
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
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      spaces: [
        {
          id: "SPC_01",
          organizationId: "ORG_01",
          role: "PM",
          status: "ACTIVE",
        },
      ],
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      role: "PM",
      status: "ACTIVE",
    },
    status: "authenticated" as const,
  } as { currentSpace?: unknown; session: unknown; status: string },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const {
  listIntakeItemsMock,
  acceptIntakeItemMock,
  deferIntakeItemMock,
  getIntakeItemMock,
  rejectIntakeItemMock,
  updateIntakeItemMock,
  listWorkItemsMock,
  listCommentsMock,
  createCommentMock,
  listTimelineMock,
} = vi.hoisted(() => ({
  listIntakeItemsMock: vi.fn(),
  acceptIntakeItemMock: vi.fn(),
  deferIntakeItemMock: vi.fn(),
  getIntakeItemMock: vi.fn(),
  rejectIntakeItemMock: vi.fn(),
  updateIntakeItemMock: vi.fn(),
  listWorkItemsMock: vi.fn(),
  listCommentsMock: vi.fn(),
  createCommentMock: vi.fn(),
  listTimelineMock: vi.fn(),
}));
vi.mock("../../lib/intake-service", () => ({
  listIntakeItems: listIntakeItemsMock,
  acceptIntakeItem: acceptIntakeItemMock,
  deferIntakeItem: deferIntakeItemMock,
  getIntakeItem: getIntakeItemMock,
  rejectIntakeItem: rejectIntakeItemMock,
  updateIntakeItem: updateIntakeItemMock,
}));
vi.mock("../../lib/work-item-service", () => ({
  listWorkItems: listWorkItemsMock,
}));
vi.mock("../../lib/comment-service", () => ({
  listComments: listCommentsMock,
  createComment: createCommentMock,
}));
vi.mock("../../lib/timeline-service", () => ({
  listTimeline: listTimelineMock,
}));

const { listRequirementsMock, listSpaceMembersMock, listVersionsMock } =
  vi.hoisted(() => ({
    listRequirementsMock: vi.fn(),
    listSpaceMembersMock: vi.fn(),
    listVersionsMock: vi.fn(),
  }));
vi.mock("../../lib/requirement-service", () => ({
  listRequirements: listRequirementsMock,
}));
vi.mock("../../lib/space-service", () => ({
  listSpaceMembers: listSpaceMembersMock,
}));
vi.mock("../../lib/version-service", () => ({
  listVersions: listVersionsMock,
}));

const memberMap = new Map<
  string,
  { user: { name: string; username: string } }
>();
const versionMap = new Map<string, { name: string }>();
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
}));

vi.mock("./create-intake-dialog", () => ({
  CreateIntakeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-intake-dialog-open" /> : null,
}));
vi.mock("./convert-intake-dialog", () => ({
  ConvertIntakeDialog: ({
    intakeItem,
    onConverted,
    onOpenChange,
    open,
  }: {
    intakeItem?: { id: string } | null;
    onConverted?: (result: {
      intakeItemId: string;
      workItems: unknown[];
    }) => void;
    onOpenChange?: (open: boolean) => void;
    open: boolean;
  }) =>
    open ? (
      <div data-testid="convert-intake-dialog-open">
        <button
          type="button"
          onClick={() => {
            if (intakeItem) {
              onConverted?.({ intakeItemId: intakeItem.id, workItems: [] });
            }
            onOpenChange?.(false);
          }}
        >
          converted
        </button>
      </div>
    ) : null,
}));
vi.mock("../work-item/task-detail-sheet", () => ({
  TaskDetailSheet: ({
    item,
    onChanged,
    onOpenChange,
    open,
  }: {
    item?: { id: string; title: string } | null;
    onChanged?: () => void;
    onOpenChange?: (open: boolean) => void;
    open: boolean;
  }) =>
    open && item ? (
      <div data-testid="task-detail-sheet" data-task-id={item.id}>
        <span>{item.title}</span>
        <button
          type="button"
          data-testid="task-detail-sheet-close"
          onClick={() => onOpenChange?.(false)}
        >
          close task
        </button>
        <button
          type="button"
          data-testid="task-detail-sheet-changed"
          onClick={() => onChanged?.()}
        >
          changed task
        </button>
      </div>
    ) : null,
}));

import { IntakePage } from "./intake-page";
import { createRecentStorageKey } from "../shell/recent-opens";
import enMessages from "../../../messages/en-US.json";
import zhMessages from "../../../messages/zh-CN.json";

function makeIntake(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    spaceId: "SPC_01",
    title: "Customer feedback: cannot reset password",
    description: "User reported a password reset bug",
    status: "PENDING",
    priority: "MEDIUM",
    sourceType: "CUSTOMER_FEEDBACK",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    versionId: undefined,
    acceptedAt: undefined,
    ...overrides,
  } as unknown as import("@project-delivery/shared").IntakeItem;
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FT1",
    type: "TASK",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Converted task",
    priority: "MEDIUM",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
    statusCategory: "NOT_STARTED",
    lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
    intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5F04",
    ...overrides,
  } as unknown as import("@project-delivery/shared").WorkItem;
}

beforeEach(() => {
  listIntakeItemsMock.mockReset();
  acceptIntakeItemMock.mockReset();
  deferIntakeItemMock.mockReset();
  getIntakeItemMock.mockReset();
  rejectIntakeItemMock.mockReset();
  updateIntakeItemMock.mockReset();
  listWorkItemsMock.mockReset();
  listWorkItemsMock.mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 10,
    total: 0,
  });
  listCommentsMock.mockReset();
  createCommentMock.mockReset();
  listTimelineMock.mockReset();
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();
  listRequirementsMock.mockResolvedValue({ items: [], total: 0 });
  listSpaceMembersMock.mockResolvedValue({ items: [], total: 0 });
  listVersionsMock.mockResolvedValue({ items: [], total: 0 });
  listCommentsMock.mockResolvedValue({ items: [], total: 0 });
  listTimelineMock.mockResolvedValue({ items: [], total: 0 });
  memberMap.clear();
  versionMap.clear();
  routerPushMock.mockReset();
  searchParamsMock.current = new URLSearchParams();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      spaces: [
        {
          id: "SPC_01",
          organizationId: "ORG_01",
          role: "PM",
          status: "ACTIVE",
        },
      ],
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
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

describe("IntakePage", () => {
  it("has noDueDate copy in both locales for related task metadata", () => {
    expect(zhMessages.intakeItems.noDueDate).toBe("未设置");
    expect(enMessages.intakeItems.noDueDate).toBe("Not set");
  });

  it("opens an intake item detail drawer from the id query", async () => {
    searchParamsMock.current = new URLSearchParams(
      "id=01ARZ3NDEKTSV4RRFFQ69G5FID",
    );
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FID",
          title: "Deep linked intake",
        }),
      ],
      total: 1,
    });

    render(<IntakePage />);

    expect(await screen.findByText("Deep linked intake")).toBeInTheDocument();
    expect(
      await screen.findByTestId("intake-detail-sheet"),
    ).toBeInTheDocument();
    expect(getIntakeItemMock).not.toHaveBeenCalled();
  });

  it("renders intake rows with title, source type and status badge", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
          title: "Idea: bulk export",
          status: "PENDING",
        }),
      ],
      total: 1,
    });

    render(<IntakePage />);

    await waitFor(() => expect(listIntakeItemsMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Idea: bulk export")).toBeInTheDocument();
    // Source type badge.
    expect(
      screen.getAllByText("intakeItems.sourceType.CUSTOMER_FEEDBACK").length,
    ).toBeGreaterThanOrEqual(1);
    // Status badge label.
    expect(
      screen.getAllByText("intakeItems.status.PENDING").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders intake status bucket totals from the paged list response", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          title: "Only loaded intake",
          status: "PENDING",
        }),
      ],
      statusCounts: [
        { status: "PENDING", count: 12 },
        { status: "ACCEPTED", count: 4 },
        { status: "CONVERTED", count: 3 },
      ],
      total: 19,
    });

    render(<IntakePage />);

    expect(await screen.findByText("Only loaded intake")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("button", { name: /intake\.filters\.all/ }),
      ).getByText("19"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("button", { name: /intake\.filters\.pending/ }),
      ).getByText("12"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("button", { name: /intake\.filters\.accepted/ }),
      ).getByText("4"),
    ).toBeInTheDocument();
  });

  it("renders real version, reporter, and assignee labels from lookups", async () => {
    const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5FRP";
    const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FAS";
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    memberMap.set(reporterId, {
      user: { name: "Reporter Name", username: "reporter" },
    });
    memberMap.set(assigneeId, {
      user: { name: "Assignee Name", username: "assignee" },
    });
    versionMap.set(versionId, { name: "Release 2026.5" });
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          assigneeId,
          reporterId,
          title: "Lookup intake",
          versionId,
        }),
      ],
      total: 1,
    });

    render(<IntakePage />);

    expect(await screen.findByText("Lookup intake")).toBeInTheDocument();
    expect(screen.getByText("Release 2026.5")).toBeInTheDocument();
    expect(screen.getByText("Assignee Name")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Lookup intake"));

    expect(screen.getByText("Reporter Name")).toBeInTheDocument();
    expect(screen.getAllByText("Assignee Name").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("renders the empty state when there are no intake items", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<IntakePage />);

    await waitFor(() => expect(listIntakeItemsMock).toHaveBeenCalled());
    expect(
      await screen.findByText("intake.states.empty.title"),
    ).toBeInTheDocument();
  });

  it("renders the error state when listIntakeItems rejects", async () => {
    listIntakeItemsMock.mockRejectedValueOnce(new Error("network"));

    render(<IntakePage />);

    expect(
      await screen.findByText("intake.states.error.title"),
    ).toBeInTheDocument();
  });

  it("shows the loading state while listIntakeItems is pending", async () => {
    let resolve: (value: {
      items: unknown[];
      total: number;
    }) => void = () => {};
    listIntakeItemsMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    const { container } = render(<IntakePage />);

    await waitFor(() => expect(listIntakeItemsMock).toHaveBeenCalled());
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );

    resolve({ items: [], total: 0 });
    await waitFor(() =>
      expect(screen.getByText("intake.states.empty.title")).toBeInTheDocument(),
    );
  });

  it("filters rows by status when a bucket button is clicked", async () => {
    listIntakeItemsMock
      .mockResolvedValueOnce({
        items: [
          makeIntake({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
            title: "Pending one",
            status: "PENDING",
          }),
          makeIntake({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            title: "Accepted one",
            status: "ACCEPTED",
          }),
          makeIntake({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F03",
            title: "Rejected one",
            status: "REJECTED",
          }),
        ],
        total: 3,
      })
      .mockResolvedValueOnce({
        items: [
          makeIntake({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            title: "Accepted one",
            status: "ACCEPTED",
          }),
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [
          makeIntake({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F03",
            title: "Rejected one",
            status: "REJECTED",
          }),
        ],
        total: 1,
      });

    render(<IntakePage />);

    expect(await screen.findByText("Pending one")).toBeInTheDocument();
    expect(screen.getByText("Accepted one")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /intake\.filters\.accepted/ }),
    );

    await waitFor(() =>
      expect(listIntakeItemsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "ACCEPTED" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Pending one")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Accepted one")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /intakeItems\.status\.REJECTED/ }),
    );

    await waitFor(() =>
      expect(listIntakeItemsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "REJECTED" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Accepted one")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Rejected one")).toBeInTheDocument();
  });

  it("sends version, requirement, priority, source type, and assignee filters to the backend", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
    const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
    versionMap.set(versionId, { name: "M2" });
    memberMap.set(assigneeId, {
      user: { name: "Alice", username: "alice" },
    });
    listRequirementsMock.mockResolvedValueOnce({
      items: [{ id: requirementId, title: "Requirement A", versionId }],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValue({
      items: [makeIntake({ title: "Filtered intake" })],
      total: 1,
    });

    render(<IntakePage />);

    await screen.findByText("Filtered intake");
    fireEvent.click(screen.getByTestId("intake-filter-button"));
    expect(await screen.findByText("Requirement A")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("intake-filter-version"), {
      target: { value: versionId },
    });
    await waitFor(() =>
      expect(listIntakeItemsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ versionId }),
      ),
    );

    fireEvent.change(screen.getByTestId("intake-filter-requirement"), {
      target: { value: requirementId },
    });
    await waitFor(() =>
      expect(listIntakeItemsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ requirementId, versionId }),
      ),
    );

    fireEvent.change(screen.getByTestId("intake-filter-priority"), {
      target: { value: "HIGH" },
    });
    await waitFor(() =>
      expect(listIntakeItemsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ priority: "HIGH", requirementId, versionId }),
      ),
    );

    fireEvent.change(screen.getByTestId("intake-filter-source"), {
      target: { value: "MEETING_DECISION" },
    });
    await waitFor(() =>
      expect(listIntakeItemsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          priority: "HIGH",
          requirementId,
          sourceType: "MEETING_DECISION",
          versionId,
        }),
      ),
    );

    fireEvent.change(screen.getByTestId("intake-filter-assignee"), {
      target: { value: assigneeId },
    });
    await waitFor(() =>
      expect(listIntakeItemsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assigneeId,
          priority: "HIGH",
          requirementId,
          sourceType: "MEETING_DECISION",
          versionId,
        }),
      ),
    );
  });

  it("links version and requirement filters", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const versionTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
    const requirementTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
    const unversionedRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR3";
    versionMap.set(versionId, { name: "M1" });
    versionMap.set(versionTwoId, { name: "M2" });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        { id: requirementId, title: "Requirement v1", versionId },
        {
          id: requirementTwoId,
          title: "Requirement v2",
          versionId: versionTwoId,
        },
        { id: unversionedRequirementId, title: "Requirement no version" },
      ],
      total: 3,
    });
    listIntakeItemsMock.mockResolvedValue({
      items: [makeIntake({ title: "Filtered intake" })],
      total: 1,
    });

    render(<IntakePage />);

    await screen.findByText("Filtered intake");
    fireEvent.click(screen.getByTestId("intake-filter-button"));
    await screen.findByText("Requirement v1");

    const versionSelect = screen.getByTestId(
      "intake-filter-version",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "intake-filter-requirement",
    ) as HTMLSelectElement;

    fireEvent.change(requirementSelect, {
      target: { value: requirementTwoId },
    });

    await waitFor(() => expect(versionSelect.value).toBe(versionTwoId));
    expect(requirementSelect.value).toBe(requirementTwoId);
    expect(
      screen.queryByText("Requirement no version"),
    ).not.toBeInTheDocument();
    expect(listIntakeItemsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requirementId: requirementTwoId,
        versionId: versionTwoId,
      }),
    );

    fireEvent.change(versionSelect, { target: { value: versionId } });

    await waitFor(() => expect(requirementSelect.value).toBe(""));
    expect(screen.getByText("Requirement v1")).toBeInTheDocument();
    expect(screen.queryByText("Requirement v2")).not.toBeInTheDocument();
    await waitFor(() => {
      const lastCall = listIntakeItemsMock.mock.lastCall?.[0];
      expect(lastCall).toEqual(
        expect.objectContaining({
          requirementId: undefined,
          versionId,
        }),
      );
    });
  });

  it("opens the create intake dialog when the 创建 button is clicked", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<IntakePage />);

    await waitFor(() => expect(listIntakeItemsMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "intake.page.create" }));
    expect(
      await screen.findByTestId("create-intake-dialog-open"),
    ).toBeInTheDocument();
  });

  it("opens the detail drawer when an intake row is clicked and accepts it", async () => {
    const original = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
      title: "Click me",
      status: "PENDING",
    });
    listIntakeItemsMock.mockResolvedValueOnce({ items: [original], total: 1 });
    acceptIntakeItemMock.mockResolvedValueOnce({
      ...original,
      status: "ACCEPTED",
    });
    // The component re-loads after accept; provide a fresh page.
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [{ ...original, status: "ACCEPTED" }],
      total: 1,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Click me"));

    // Sheet rendered the accept button. Click it.
    const acceptBtn = await screen.findByRole("button", {
      name: "intakeItems.statusActions.accept",
    });
    fireEvent.click(acceptBtn);

    await waitFor(() =>
      expect(acceptIntakeItemMock).toHaveBeenCalledWith({
        intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5F01",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      }),
    );
  });

  it("loads related tasks, comments, timeline, and posts a new intake comment", async () => {
    const intake = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
      acceptedAt: "2026-05-11T00:00:00.000Z",
      title: "Detail resources",
      status: "ACCEPTED",
    });
    const acceptedAtLabel = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date("2026-05-11T00:00:00.000Z"));
    const relatedTaskDueDate = "2026-06-01T00:00:00.000Z";
    const relatedTaskDueDateLabel = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
    }).format(new Date(relatedTaskDueDate));
    const existingEventTimeLabel = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date("2026-05-12T00:00:00.000Z"));
    listIntakeItemsMock.mockResolvedValueOnce({ items: [intake], total: 1 });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        makeTask({
          dueDate: relatedTaskDueDate,
          title: "Related task from API",
        }),
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    listCommentsMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          targetType: "INTAKE_ITEM",
          targetId: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
          author: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
            username: "alice",
            name: "Alice",
          },
          body: "Existing intake comment",
          createdAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      total: 1,
    });
    listTimelineMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FTL",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          target: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
            type: "INTAKE_ITEM",
            title: "Detail resources",
          },
          eventType: "CREATED",
          actor: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
            username: "alice",
            name: "Alice",
          },
          title: "created the intake item",
          createdAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      total: 1,
    });
    listTimelineMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FTL2",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          target: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
            type: "INTAKE_ITEM",
            title: "Detail resources",
          },
          eventType: "COMMENT_CREATED",
          actor: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FU2",
            username: "bob",
            name: "Bob",
          },
          title: "commented on the intake item",
          createdAt: "2026-05-13T00:00:00.000Z",
        },
      ],
      total: 1,
    });
    createCommentMock.mockResolvedValueOnce({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FC2",
      organizationId: "ORG_01",
      spaceId: "SPC_01",
      targetType: "INTAKE_ITEM",
      targetId: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
      author: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FU2",
        username: "bob",
        name: "Bob",
      },
      body: "New intake comment",
      createdAt: "2026-05-13T00:00:00.000Z",
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Detail resources"));

    expect(
      await screen.findByText("Related task from API"),
    ).toBeInTheDocument();
    expect(screen.getByText(acceptedAtLabel)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(relatedTaskDueDateLabel, "u")),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Existing intake comment"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(existingEventTimeLabel).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByText("2026-05-12T00:00:00.000Z"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(relatedTaskDueDate)).not.toBeInTheDocument();
    expect(
      await screen.findByText("created the intake item"),
    ).toBeInTheDocument();
    expect(listWorkItemsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
        page: 1,
        pageSize: 10,
        spaceId: "SPC_01",
      }),
    );
    expect(listCommentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
        targetType: "INTAKE_ITEM",
      }),
    );
    expect(listTimelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
        targetType: "INTAKE_ITEM",
      }),
    );

    fireEvent.change(screen.getByTestId("intake-comment-input"), {
      target: { value: "  New intake comment  " },
    });
    fireEvent.click(screen.getByTestId("intake-comment-submit"));

    await waitFor(() => expect(createCommentMock).toHaveBeenCalledTimes(1));
    expect(createCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "New intake comment",
        targetId: "01ARZ3NDEKTSV4RRFFQ69G5FDT",
        targetType: "INTAKE_ITEM",
      }),
    );
    expect(await screen.findByText("New intake comment")).toBeInTheDocument();
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("commented on the intake item"),
    ).toBeInTheDocument();
  });

  it("renders noDueDate fallback for related tasks without a due date", async () => {
    const intake = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FND",
      title: "No due date intake",
      status: "ACCEPTED",
    });
    listIntakeItemsMock.mockResolvedValueOnce({ items: [intake], total: 1 });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [makeTask({ dueDate: undefined, title: "No due task" })],
      page: 1,
      pageSize: 10,
      total: 1,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("No due date intake"));

    expect(await screen.findByText("No due task")).toBeInTheDocument();
    expect(screen.getByText(/intakeItems\.noDueDate/u)).toBeInTheDocument();
  });

  it("updates the active intake item and list after editing", async () => {
    const original = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
      title: "Original intake",
      description: "Original description",
      sourceType: "AD_HOC",
      priority: "MEDIUM",
    });
    const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [
        {
          userId: assigneeId,
          user: { name: "Alice", username: "alice" },
        },
      ],
      total: 1,
    });
    const updated = {
      ...original,
      assigneeId,
      title: "Edited intake",
      description: "Edited description",
      priority: "HIGH",
      sourceObject: { meetingId: "m-1" },
    };
    listIntakeItemsMock.mockResolvedValueOnce({ items: [original], total: 1 });
    updateIntakeItemMock.mockResolvedValueOnce(updated);

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Original intake"));
    fireEvent.click(await screen.findByTestId("intake-edit-button"));

    const titleInput = await screen.findByTestId("edit-intake-title-input");
    fireEvent.change(titleInput, {
      target: { value: "  Edited intake  " },
    });
    fireEvent.change(screen.getByTestId("edit-intake-description-input"), {
      target: { value: "  Edited description  " },
    });
    fireEvent.change(screen.getByTestId("edit-intake-priority-select"), {
      target: { value: "HIGH" },
    });
    await screen.findByText("Alice");
    fireEvent.change(screen.getByTestId("edit-intake-assignee-select"), {
      target: { value: assigneeId },
    });
    fireEvent.change(screen.getByTestId("edit-intake-source-object-input"), {
      target: { value: '{ "meetingId": "m-1" }' },
    });
    fireEvent.click(screen.getByTestId("edit-intake-submit"));

    await waitFor(() =>
      expect(updateIntakeItemMock).toHaveBeenCalledWith(
        {
          intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
          spaceId: "SPC_01",
        },
        expect.objectContaining({
          assigneeId,
          description: "Edited description",
          priority: "HIGH",
          sourceObject: { meetingId: "m-1" },
          sourceType: "AD_HOC",
          title: "Edited intake",
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("edit-intake-dialog"),
      ).not.toBeInTheDocument(),
    );

    expect(screen.getAllByText("Edited intake").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("Edited description")).toBeInTheDocument();
    expect(screen.queryByText("Original intake")).not.toBeInTheDocument();
  });

  it("submits nulls when optional intake fields are cleared", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
    const original = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FE2",
      title: "Clearable intake",
      description: "Description to clear",
      sourceType: "AD_HOC",
      priority: "MEDIUM",
      requirementId,
      versionId,
    });
    listVersionsMock.mockResolvedValueOnce({
      items: [{ id: versionId, name: "Release 1" }],
      total: 1,
    });
    listRequirementsMock.mockResolvedValueOnce({
      items: [{ id: requirementId, title: "Requirement 1" }],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValueOnce({ items: [original], total: 1 });
    updateIntakeItemMock.mockResolvedValueOnce({
      ...original,
      description: undefined,
      priority: undefined,
      requirementId: undefined,
      versionId: undefined,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Clearable intake"));
    fireEvent.click(await screen.findByTestId("intake-edit-button"));

    await screen.findByText("Release 1");
    fireEvent.change(screen.getByTestId("edit-intake-description-input"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-intake-priority-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-intake-version-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-intake-requirement-select"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("edit-intake-submit"));

    await waitFor(() =>
      expect(updateIntakeItemMock).toHaveBeenCalledWith(
        {
          intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5FE2",
          spaceId: "SPC_01",
        },
        expect.objectContaining({
          description: null,
          priority: null,
          requirementId: null,
          versionId: null,
        }),
      ),
    );
  });

  it("records directly opened intake items in recent opens", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FRC",
          title: "Remember intake",
        }),
      ],
      total: 1,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Remember intake"));

    const stored = JSON.parse(
      window.localStorage.getItem(
        createRecentStorageKey({
          organizationId: "ORG_01",
          spaceId: "SPC_01",
        }),
      ) ?? "[]",
    ) as Array<{ href: string; title: string; type: string }>;
    expect(stored[0]).toMatchObject({
      href: "/intake-items?id=01ARZ3NDEKTSV4RRFFQ69G5FRC",
      title: "Remember intake",
      type: "INTAKE",
    });
  });

  it("runs the primary intake action with S for the active row", async () => {
    const original = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FS1",
      title: "Keyboard accept",
      status: "PENDING",
    });
    listIntakeItemsMock.mockResolvedValueOnce({ items: [original], total: 1 });
    acceptIntakeItemMock.mockResolvedValueOnce({
      ...original,
      status: "ACCEPTED",
    });
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [{ ...original, status: "ACCEPTED" }],
      total: 1,
    });

    render(<IntakePage />);

    await screen.findByText("Keyboard accept");
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "s" });

    await waitFor(() =>
      expect(acceptIntakeItemMock).toHaveBeenCalledWith({
        intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5FS1",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      }),
    );
  });

  it("opens the intake edit affordance with A without running status actions", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA0",
          title: "Assign shortcut target",
        }),
      ],
      total: 1,
    });

    render(<IntakePage />);

    await screen.findByText("Assign shortcut target");
    fireEvent.keyDown(window, { key: "j" });

    const assignEvent = new KeyboardEvent("keydown", {
      key: "a",
      cancelable: true,
    });
    window.dispatchEvent(assignEvent);

    expect(assignEvent.defaultPrevented).toBe(true);
    expect(await screen.findByTestId("edit-intake-dialog")).toBeInTheDocument();
    expect(
      screen.queryByTestId("convert-intake-dialog-open"),
    ).not.toBeInTheDocument();
    expect(acceptIntakeItemMock).not.toHaveBeenCalled();
    expect(rejectIntakeItemMock).not.toHaveBeenCalled();
  });

  it("allows deferred intake items to be accepted or rejected without showing defer again", async () => {
    const original = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FDF",
      title: "Deferred follow-up",
      status: "DEFERRED",
    });
    listIntakeItemsMock.mockResolvedValueOnce({ items: [original], total: 1 });
    acceptIntakeItemMock.mockResolvedValueOnce({
      ...original,
      status: "ACCEPTED",
    });
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [{ ...original, status: "ACCEPTED" }],
      total: 1,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Deferred follow-up"));

    expect(
      await screen.findByTestId("intake-accept-button"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("intake-reject-button")).toBeInTheDocument();
    expect(screen.queryByTestId("intake-defer-button")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "s" });

    await waitFor(() =>
      expect(acceptIntakeItemMock).toHaveBeenCalledWith({
        intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5FDF",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      }),
    );
  });

  it("marks the keyboard-selected intake row as aria-selected", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({ id: "01ARZ3NDEKTSV4RRFFQ69G5F01", title: "First intake" }),
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
          title: "Second intake",
        }),
      ],
      total: 2,
    });

    render(<IntakePage />);

    await screen.findByText("First intake");
    fireEvent.keyDown(window, { key: "j" });

    const rows = screen.getAllByTestId("intake-row");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveAttribute("data-id", "01ARZ3NDEKTSV4RRFFQ69G5F01");
    expect(rows[1]).toHaveAttribute("aria-selected", "false");
  });

  it("keeps the detail drawer closed when Escape is pressed during accept", async () => {
    const original = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5F03",
      title: "Close while accepting",
      status: "PENDING",
    });
    let resolveAccept: (
      value: import("@project-delivery/shared").IntakeItem,
    ) => void = () => undefined;

    listIntakeItemsMock.mockResolvedValueOnce({ items: [original], total: 1 });
    acceptIntakeItemMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAccept = resolve;
        }),
    );
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [{ ...original, status: "ACCEPTED" }],
      total: 1,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Close while accepting"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "intakeItems.statusActions.accept",
      }),
    );
    expect(
      await screen.findByTestId("intake-convert-button"),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByTestId("intake-detail-sheet"),
      ).not.toBeInTheDocument(),
    );

    await act(async () => {
      resolveAccept({ ...original, status: "ACCEPTED" });
      await Promise.resolve();
    });

    await waitFor(() => expect(listIntakeItemsMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("intake-detail-sheet")).not.toBeInTheDocument();
  });

  it("marks the active intake as converted after task breakdown succeeds", async () => {
    const original = makeIntake({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FCV",
      title: "Breakdown target",
      status: "ACCEPTED",
    });
    listIntakeItemsMock
      .mockResolvedValueOnce({ items: [original], total: 1 })
      .mockResolvedValueOnce({
        items: [{ ...original, status: "CONVERTED" }],
        total: 1,
      });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Breakdown target"));
    fireEvent.click(await screen.findByTestId("intake-convert-button"));
    const convertDialog = await screen.findByTestId(
      "convert-intake-dialog-open",
    );
    fireEvent.click(within(convertDialog).getByText("converted"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("intake-convert-button"),
      ).not.toBeInTheDocument(),
    );
  });

  it("opens converted intake related task list from the related section", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F04",
          title: "Already converted",
          status: "CONVERTED",
        }),
      ],
      total: 1,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Already converted"));
    const openTaskList = await screen.findByTestId(
      "intake-related-tasks-open-list",
    );

    expect(openTaskList).not.toBeDisabled();
    fireEvent.click(openTaskList);
    await waitFor(() =>
      expect(listWorkItemsMock).toHaveBeenCalledWith({
        intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5F04",
        organizationId: "ORG_01",
        page: 1,
        pageSize: 10,
        spaceId: "SPC_01",
      }),
    );
    expect(routerPushMock).toHaveBeenCalledWith(
      "/work-items?intakeItemId=01ARZ3NDEKTSV4RRFFQ69G5F04",
    );
    expect(
      screen.queryByTestId("convert-intake-dialog-open"),
    ).not.toBeInTheDocument();
  });

  it("paginates related tasks and opens the full task detail sheet in place", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FP1",
          title: "Paginated related tasks",
          status: "CONVERTED",
        }),
      ],
      total: 1,
    });
    const firstPageTasks = Array.from({ length: 10 }, (_, index) =>
      makeTask({
        id: `01ARZ3NDEKTSV4RRFFQ69G5T${String(index).padStart(2, "0")}`,
        title: `Related task ${index + 1}`,
      }),
    );
    const secondPageTasks = [
      makeTask({
        id: "01ARZ3NDEKTSV4RRFFQ69G5T10",
        title: "Related task 11",
      }),
      makeTask({
        id: "01ARZ3NDEKTSV4RRFFQ69G5T11",
        title: "Related task 12",
      }),
    ];
    listWorkItemsMock
      .mockResolvedValueOnce({
        items: firstPageTasks,
        page: 1,
        pageSize: 10,
        total: 12,
      })
      .mockResolvedValueOnce({
        items: secondPageTasks,
        page: 2,
        pageSize: 10,
        total: 12,
      })
      .mockResolvedValueOnce({
        items: [makeTask({ title: "Refreshed related task" })],
        page: 1,
        pageSize: 10,
        total: 1,
      });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Paginated related tasks"));

    expect(await screen.findByText("Related task 1")).toBeInTheDocument();
    expect(
      screen.getByTestId("intake-related-tasks-pagination-summary"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("intake-related-tasks-load-more"));

    expect(await screen.findByText("Related task 12")).toBeInTheDocument();
    await waitFor(() =>
      expect(listWorkItemsMock).toHaveBeenCalledWith({
        intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5FP1",
        organizationId: "ORG_01",
        page: 2,
        pageSize: 10,
        spaceId: "SPC_01",
      }),
    );

    fireEvent.click(screen.getByText("Related task 12"));

    expect(await screen.findByTestId("task-detail-sheet")).toHaveAttribute(
      "data-task-id",
      "01ARZ3NDEKTSV4RRFFQ69G5T11",
    );
    expect(routerPushMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("task-detail-sheet-changed"));

    await waitFor(() => expect(listWorkItemsMock).toHaveBeenCalledTimes(3));
    expect(listWorkItemsMock).toHaveBeenLastCalledWith({
      intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5FP1",
      organizationId: "ORG_01",
      page: 1,
      pageSize: 10,
      spaceId: "SPC_01",
    });
  });

  it("resets related task load-more state when a detail refresh supersedes it", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FLM",
          title: "Concurrent related tasks",
          status: "CONVERTED",
        }),
      ],
      total: 1,
    });
    const firstPageTasks = Array.from({ length: 10 }, (_, index) =>
      makeTask({
        id: `01ARZ3NDEKTSV4RRFFQ69G5L${String(index).padStart(2, "0")}`,
        title: `Concurrent task ${index + 1}`,
      }),
    );
    let resolveAppend: (value: {
      items: import("@project-delivery/shared").WorkItem[];
      page: number;
      pageSize: number;
      total: number;
    }) => void = () => undefined;

    listWorkItemsMock
      .mockResolvedValueOnce({
        items: firstPageTasks,
        page: 1,
        pageSize: 10,
        total: 12,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAppend = resolve;
          }),
      )
      .mockResolvedValueOnce({
        items: firstPageTasks,
        page: 1,
        pageSize: 10,
        total: 12,
      });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Concurrent related tasks"));
    expect(await screen.findByText("Concurrent task 1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("intake-related-tasks-load-more"));
    expect(screen.getByTestId("intake-related-tasks-load-more")).toBeDisabled();

    fireEvent.click(screen.getByText("Concurrent task 1"));
    expect(await screen.findByTestId("task-detail-sheet")).toHaveAttribute(
      "data-task-id",
      "01ARZ3NDEKTSV4RRFFQ69G5L00",
    );

    fireEvent.click(screen.getByTestId("task-detail-sheet-changed"));

    await waitFor(() => expect(listWorkItemsMock).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(
        screen.getByTestId("intake-related-tasks-load-more"),
      ).not.toBeDisabled(),
    );

    await act(async () => {
      resolveAppend({
        items: [makeTask({ title: "Stale append task" })],
        page: 2,
        pageSize: 10,
        total: 12,
      });
      await Promise.resolve();
    });
  });

  it("lets VIEWER open related task detail while task operations stay delegated to the task sheet", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: "SPC_01",
        spaces: [
          {
            id: "SPC_01",
            organizationId: "ORG_01",
            role: "VIEWER",
            status: "ACTIVE",
          },
        ],
      },
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        role: "VIEWER",
        status: "ACTIVE",
      },
      status: "authenticated" as const,
    };
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FVR",
          title: "Viewer related tasks",
          status: "CONVERTED",
        }),
      ],
      total: 1,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        makeTask({
          id: "01ARZ3NDEKTSV4RRFFQ69G5TVR",
          title: "Viewer task",
        }),
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Viewer related tasks"));
    expect(screen.queryByTestId("intake-edit-button")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByText("Viewer task"));

    expect(await screen.findByTestId("task-detail-sheet")).toHaveAttribute(
      "data-task-id",
      "01ARZ3NDEKTSV4RRFFQ69G5TVR",
    );
  });

  it("hides write actions for VIEWER space role", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: "SPC_01",
        spaces: [
          {
            id: "SPC_01",
            organizationId: "ORG_01",
            role: "VIEWER",
            status: "ACTIVE",
          },
        ],
      },
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        role: "VIEWER",
        status: "ACTIVE",
      },
      status: "authenticated" as const,
    };
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
          title: "Read only intake",
          status: "PENDING",
        }),
      ],
      total: 1,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Read only intake"));

    expect(
      screen.queryByTestId("intake-create-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("intake-accept-button"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("intake-defer-button")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("intake-reject-button"),
    ).not.toBeInTheDocument();
  });

  it("allows create and comments but hides management actions for non-admin non-PM space roles", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: "SPC_01",
        spaces: [
          {
            id: "SPC_01",
            organizationId: "ORG_01",
            role: "REQUIREMENT",
            status: "ACTIVE",
          },
        ],
      },
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        role: "REQUIREMENT",
        status: "ACTIVE",
      },
      status: "authenticated" as const,
    };
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FDV",
          title: "Developer pending intake",
          status: "PENDING",
        }),
        makeIntake({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FDA",
          title: "Developer accepted intake",
          status: "ACCEPTED",
        }),
      ],
      total: 2,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Developer pending intake"));

    expect(screen.getByTestId("intake-create-button")).toBeInTheDocument();
    expect(screen.queryByTestId("intake-edit-button")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("intake-accept-button"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("intake-defer-button")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("intake-reject-button"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("intake-comment-input")).toBeInTheDocument();
    expect(
      screen.queryByTestId("intake-comments-readonly"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Developer accepted intake"));

    expect(
      screen.queryByTestId("intake-convert-button"),
    ).not.toBeInTheDocument();
  });

  it("renders the noSpace empty state when session has no defaultSpaceId", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: undefined,
        spaces: [],
      },
      currentSpace: undefined,
      status: "authenticated" as const,
    };

    render(<IntakePage />);

    expect(
      await screen.findByText("intake.states.noSpace.title"),
    ).toBeInTheDocument();
    expect(listIntakeItemsMock).not.toHaveBeenCalled();
  });
});
