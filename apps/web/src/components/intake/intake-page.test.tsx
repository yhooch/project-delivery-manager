import {
  act,
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
const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
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
        },
      ],
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      role: "PM",
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
  rejectIntakeItemMock,
  listWorkItemsMock,
} = vi.hoisted(() => ({
  listIntakeItemsMock: vi.fn(),
  acceptIntakeItemMock: vi.fn(),
  deferIntakeItemMock: vi.fn(),
  rejectIntakeItemMock: vi.fn(),
  listWorkItemsMock: vi.fn(),
}));
vi.mock("../../lib/intake-service", () => ({
  listIntakeItems: listIntakeItemsMock,
  acceptIntakeItem: acceptIntakeItemMock,
  deferIntakeItem: deferIntakeItemMock,
  rejectIntakeItem: rejectIntakeItemMock,
}));
vi.mock("../../lib/work-item-service", () => ({
  listWorkItems: listWorkItemsMock,
}));

vi.mock("./create-intake-dialog", () => ({
  CreateIntakeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-intake-dialog-open" /> : null,
}));
vi.mock("./convert-intake-dialog", () => ({
  ConvertIntakeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="convert-intake-dialog-open" /> : null,
}));

import { IntakePage } from "./intake-page";
import { createRecentStorageKey } from "../shell/recent-opens";

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
  rejectIntakeItemMock.mockReset();
  listWorkItemsMock.mockReset();
  routerPushMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      spaces: [
        {
          id: "SPC_01",
          organizationId: "ORG_01",
          role: "PM",
        },
      ],
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      role: "PM",
    },
    status: "authenticated" as const,
  };
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("IntakePage", () => {
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

    await waitFor(() =>
      expect(listIntakeItemsMock).toHaveBeenCalledTimes(1),
    );
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
    let resolve: (value: { items: unknown[]; total: number }) => void = () => {};
    listIntakeItemsMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    const { container } = render(<IntakePage />);

    await waitFor(() => expect(listIntakeItemsMock).toHaveBeenCalled());
    expect(
      container.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);

    resolve({ items: [], total: 0 });
    await waitFor(() =>
      expect(
        screen.getByText("intake.states.empty.title"),
      ).toBeInTheDocument(),
    );
  });

  it("filters rows by status when a bucket button is clicked", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({
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
    });

    render(<IntakePage />);

    expect(await screen.findByText("Pending one")).toBeInTheDocument();
    expect(screen.getByText("Accepted one")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /intake\.filters\.accepted/ }),
    );

    expect(screen.queryByText("Pending one")).not.toBeInTheDocument();
    expect(screen.getByText("Accepted one")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("intake-filter-REJECTED"));

    expect(screen.queryByText("Accepted one")).not.toBeInTheDocument();
    expect(screen.getByText("Rejected one")).toBeInTheDocument();
  });

  it("opens the create intake dialog when the 创建 button is clicked", async () => {
    listIntakeItemsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<IntakePage />);

    await waitFor(() => expect(listIntakeItemsMock).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole("button", { name: "intake.page.create" }),
    );
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
    acceptIntakeItemMock.mockResolvedValueOnce({ ...original, status: "ACCEPTED" });
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
        spaceId: "SPC_01",
      }),
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
      href: "/intake-items",
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
    acceptIntakeItemMock.mockResolvedValueOnce({ ...original, status: "ACCEPTED" });
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
        spaceId: "SPC_01",
      }),
    );
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

  it("opens converted intake related tasks from the detail drawer", async () => {
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
      items: [makeTask()],
      page: 1,
      pageSize: 2,
      total: 1,
    });

    render(<IntakePage />);

    fireEvent.click(await screen.findByText("Already converted"));
    const viewTasks = await screen.findByTestId(
      "intake-view-converted-tasks-button",
    );

    expect(viewTasks).not.toBeDisabled();
    fireEvent.click(viewTasks);
    await waitFor(() =>
      expect(listWorkItemsMock).toHaveBeenCalledWith({
        intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5F04",
        page: 1,
        pageSize: 2,
        spaceId: "SPC_01",
      }),
    );
    expect(routerPushMock).toHaveBeenCalledWith(
      "/work-items?workItemId=01ARZ3NDEKTSV4RRFFQ69G5FT1",
    );
    expect(
      screen.queryByTestId("convert-intake-dialog-open"),
    ).not.toBeInTheDocument();
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
          },
        ],
      },
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        role: "VIEWER",
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

    expect(screen.queryByTestId("intake-create-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("intake-accept-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("intake-defer-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("intake-reject-button")).not.toBeInTheDocument();
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
