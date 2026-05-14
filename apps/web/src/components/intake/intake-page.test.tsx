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
    status: "authenticated" as const,
  } as { session: unknown; status: string },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const {
  listIntakeItemsMock,
  acceptIntakeItemMock,
  deferIntakeItemMock,
  rejectIntakeItemMock,
} = vi.hoisted(() => ({
  listIntakeItemsMock: vi.fn(),
  acceptIntakeItemMock: vi.fn(),
  deferIntakeItemMock: vi.fn(),
  rejectIntakeItemMock: vi.fn(),
}));
vi.mock("../../lib/intake-service", () => ({
  listIntakeItems: listIntakeItemsMock,
  acceptIntakeItem: acceptIntakeItemMock,
  deferIntakeItem: deferIntakeItemMock,
  rejectIntakeItem: rejectIntakeItemMock,
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

beforeEach(() => {
  listIntakeItemsMock.mockReset();
  acceptIntakeItemMock.mockReset();
  deferIntakeItemMock.mockReset();
  rejectIntakeItemMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    status: "authenticated" as const,
  };
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
      ],
      total: 2,
    });

    render(<IntakePage />);

    expect(await screen.findByText("Pending one")).toBeInTheDocument();
    expect(screen.getByText("Accepted one")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /intake\.filters\.accepted/ }),
    );

    expect(screen.queryByText("Pending one")).not.toBeInTheDocument();
    expect(screen.getByText("Accepted one")).toBeInTheDocument();
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

  it("renders the noSpace empty state when session has no defaultSpaceId", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: undefined,
      },
      status: "authenticated" as const,
    };

    render(<IntakePage />);

    expect(
      await screen.findByText("intake.states.noSpace.title"),
    ).toBeInTheDocument();
    expect(listIntakeItemsMock).not.toHaveBeenCalled();
  });
});
