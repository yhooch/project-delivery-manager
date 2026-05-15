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
      fn = (k: string) =>
        namespace
          ? // Resolve as `${namespace}.${k}` even when k itself contains
            // template params. The component passes plain strings.
            `${namespace}.${k}`
          : k;
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

const { refreshSessionMock, sessionMock } = vi.hoisted(() => {
  const refreshSessionMock = vi.fn();
  return {
    refreshSessionMock,
    sessionMock: {
      current: {
        session: {
          defaultOrganizationId: "ORG_01",
          defaultSpaceId: "SPC_01",
        },
        currentOrganization: { id: "ORG_01", name: "Acme Org" },
        currentSpace: {
          id: "SPC_01",
          organizationId: "ORG_01",
          name: "Space A",
          role: "SPACE_ADMIN",
          status: "ACTIVE",
        },
        refreshSession: refreshSessionMock,
        status: "authenticated" as const,
      },
    },
  };
});
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const {
  getSpaceMock,
  listSpaceMembersMock,
  updateSpaceMock,
  updateSpaceMemberMock,
} = vi.hoisted(() => ({
  getSpaceMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  updateSpaceMock: vi.fn(),
  updateSpaceMemberMock: vi.fn(),
}));
vi.mock("../../lib/space-service", () => ({
  getSpace: getSpaceMock,
  listSpaceMembers: listSpaceMembersMock,
  updateSpace: updateSpaceMock,
  updateSpaceMember: updateSpaceMemberMock,
}));

const { FakeApiClientError } = vi.hoisted(() => {
  class FakeApiClientError extends Error {
    readonly error: { code: string; message: string };
    readonly status: number;
    constructor(code: string, status: number) {
      super(code);
      this.name = "ApiClientError";
      this.error = { code, message: code };
      this.status = status;
    }
  }
  return { FakeApiClientError };
});

vi.mock("../../lib/api-client", () => ({
  ApiClientError: FakeApiClientError,
}));

vi.mock("./add-space-member-dialog", () => ({
  AddSpaceMemberDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-space-member-open" /> : null,
}));
vi.mock("./edit-space-member-role-dialog", () => ({
  EditSpaceMemberRoleDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-role-dialog-open" /> : null,
}));

import { SpaceSettingsPage } from "./settings-page";

const OWNER_ID = "01ARZ3NDEKTSV4RRFFQ69G5F01";

function makeSpace(overrides: Record<string, unknown> = {}) {
  return {
    id: "SPC_01",
    organizationId: "ORG_01",
    code: "SPC-A",
    name: "Space A",
    description: undefined,
    ownerId: undefined,
    status: "ACTIVE",
    settings: { staleThresholdDays: 3 },
    ...overrides,
  } as unknown as import("@project-delivery/shared").Space;
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "SPM_01",
    userId: OWNER_ID,
    role: "DEVELOPER",
    status: "ACTIVE",
    spaceId: "SPC_01",
    organizationId: "ORG_01",
    user: {
      id: OWNER_ID,
      name: "Alice",
      username: "alice",
    },
    ...overrides,
  } as unknown as import("@project-delivery/shared").SpaceMemberWithUser;
}

beforeEach(() => {
  getSpaceMock.mockReset();
  listSpaceMembersMock.mockReset();
  updateSpaceMock.mockReset();
  updateSpaceMemberMock.mockReset();
  refreshSessionMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentOrganization: { id: "ORG_01", name: "Acme Org" },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "SPACE_ADMIN",
      status: "ACTIVE",
    },
    refreshSession: refreshSessionMock,
    status: "authenticated" as const,
  };
});

afterEach(() => {
  cleanup();
});

describe("SpaceSettingsPage", () => {
  it("renders space basic fields and the member list when load succeeds", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [
        makeMember({ user: { id: "U1", name: "Alice", username: "alice" } }),
      ],
      total: 1,
    });

    render(<SpaceSettingsPage />);

    await waitFor(() => expect(getSpaceMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listSpaceMembersMock).toHaveBeenCalledTimes(1));

    // Name input populated.
    const nameInput = await screen.findByLabelText(
      "spaceSettings.basic.fields.name",
    );
    expect((nameInput as HTMLInputElement).value).toBe("Space A");

    // Member row.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice", { exact: true })).toBeInTheDocument();
  });

  it("renders the overview card with organization, member count, and role", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [makeMember()],
      total: 1,
    });

    render(<SpaceSettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("space-settings-overview")).toBeInTheDocument(),
    );
    expect(screen.getByText("Acme Org")).toBeInTheDocument();
    expect(
      screen.getByTestId("space-settings-status-badge"),
    ).toBeInTheDocument();
  });

  it("renders the empty member list message when there are no members", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    await waitFor(() => expect(listSpaceMembersMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("spaceSettings.members.empty"),
    ).toBeInTheDocument();
  });

  it("renders an error state when the load rejects", async () => {
    getSpaceMock.mockRejectedValueOnce(new Error("boom"));
    listSpaceMembersMock.mockRejectedValueOnce(new Error("boom"));

    render(<SpaceSettingsPage />);

    // ErrorState defaults are resolved through the shared common.states keys.
    expect(
      await screen.findByRole("button", { name: "common.states.retry" }),
    ).toBeInTheDocument();
  });

  it("shows skeleton loading rows while load is pending", async () => {
    let resolveSpace: (value: unknown) => void = () => {};
    let resolveMembers: (value: unknown) => void = () => {};
    getSpaceMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveSpace = r;
        }),
    );
    listSpaceMembersMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveMembers = r;
        }),
    );

    const { container } = render(<SpaceSettingsPage />);

    await waitFor(() => expect(getSpaceMock).toHaveBeenCalled());
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );

    resolveSpace(makeSpace());
    resolveMembers({ items: [], total: 0 });
    await waitFor(() =>
      expect(
        screen.getByText("spaceSettings.members.empty"),
      ).toBeInTheDocument(),
    );
  });

  it("opens the add member dialog when 添加成员 button is clicked", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    await waitFor(() => expect(listSpaceMembersMock).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole("button", { name: /spaceSettings\.members\.add/ }),
    );
    expect(
      await screen.findByTestId("add-space-member-open"),
    ).toBeInTheDocument();
  });

  it("renders the noSpace empty state when session has no spaceId", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: undefined as unknown as string,
      },
      currentOrganization: undefined as unknown as never,
      currentSpace: undefined as unknown as never,
      refreshSession: refreshSessionMock,
      status: "authenticated" as const,
    };

    render(<SpaceSettingsPage />);

    expect(
      await screen.findByText("spaceSettings.page.noSpace.title"),
    ).toBeInTheDocument();
    expect(getSpaceMock).not.toHaveBeenCalled();
  });

  it("saves description and owner via updateSpace and reflects the response", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [makeMember()],
      total: 1,
    });
    updateSpaceMock.mockResolvedValueOnce(
      makeSpace({
        description: "Team space",
        ownerId: OWNER_ID,
      }),
    );

    render(<SpaceSettingsPage />);

    const description = await screen.findByTestId(
      "space-settings-description-input",
    );
    const owner = await screen.findByTestId("space-settings-owner-input");

    fireEvent.change(description, { target: { value: "Team space" } });
    fireEvent.change(owner, { target: { value: OWNER_ID } });

    fireEvent.click(screen.getByTestId("space-settings-basic-submit"));

    await waitFor(() => expect(updateSpaceMock).toHaveBeenCalledTimes(1));
    expect(updateSpaceMock).toHaveBeenCalledWith("SPC_01", {
      name: "Space A",
      code: "SPC-A",
      description: "Team space",
      ownerId: OWNER_ID,
    });
    expect(refreshSessionMock).toHaveBeenCalledWith("ORG_01", "SPC_01");
  });

  it("maps a CONFLICT error on code to a field-level message", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });
    updateSpaceMock.mockRejectedValueOnce(
      new FakeApiClientError("CONFLICT", 409),
    );

    render(<SpaceSettingsPage />);

    const codeInput = await screen.findByTestId("space-settings-code-input");
    fireEvent.change(codeInput, { target: { value: "OTHER-CODE" } });
    fireEvent.click(screen.getByTestId("space-settings-basic-submit"));

    expect(
      await screen.findByTestId("space-settings-code-error"),
    ).toHaveTextContent("spaceSettings.basic.codeConflict");
  });

  it("rejects non-integer stale threshold values before saving", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    const input = await screen.findByTestId("space-settings-threshold-input");
    fireEvent.change(input, { target: { value: "30abc" } });
    fireEvent.click(screen.getByTestId("space-settings-threshold-submit"));

    expect(
      await screen.findByTestId("space-settings-threshold-error"),
    ).toHaveTextContent("spaceSettings.threshold.error");
    expect(updateSpaceMock).not.toHaveBeenCalled();
  });

  it("filters the member list by the search input", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [
        makeMember({
          id: "SPM_01",
          userId: "U1",
          user: { id: "U1", name: "Alice", username: "alice" },
        }),
        makeMember({
          id: "SPM_02",
          userId: "U2",
          user: { id: "U2", name: "Bob", username: "bob" },
        }),
      ],
      total: 2,
    });

    render(<SpaceSettingsPage />);

    await screen.findByText("Alice");
    expect(screen.getByText("Bob")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByTestId("space-settings-member-search"), "bob");

    await waitFor(() =>
      expect(screen.queryByText("Alice")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("disables all write controls when the current space role is VIEWER", async () => {
    sessionMock.current.currentSpace = {
      ...sessionMock.current.currentSpace!,
      role: "VIEWER",
    };
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [makeMember()],
      total: 1,
    });

    render(<SpaceSettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("space-settings-basic-submit")).toBeDisabled(),
    );
    expect(
      screen.getByTestId("space-settings-threshold-submit"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("space-settings-add-member-button"),
    ).toBeDisabled();
    expect(screen.getByTestId("space-settings-name-input")).toBeDisabled();
  });
});
