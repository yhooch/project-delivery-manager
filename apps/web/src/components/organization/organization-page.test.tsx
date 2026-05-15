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
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      // Components call t("key", { username: "alice" }) etc; ignore params
      // and just return the key path so assertions stay deterministic.
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
  refreshSession: vi.fn(),
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Acme Corp",
      code: "ACME",
      role: "OWNER",
      status: "ACTIVE",
    },
    currentSpace: undefined,
    refreshSession: vi.fn(),
    status: "authenticated" as const,
  } as {
    currentOrganization: unknown;
    currentSpace: unknown;
    refreshSession: unknown;
    session: unknown;
    status: string;
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const {
  disableOrganizationMemberMock,
  listOrganizationMembersMock,
  updateOrganizationMock,
  updateOrganizationMemberMock,
} = vi.hoisted(() => ({
  disableOrganizationMemberMock: vi.fn(),
  listOrganizationMembersMock: vi.fn(),
  updateOrganizationMock: vi.fn(),
  updateOrganizationMemberMock: vi.fn(),
}));
vi.mock("../../lib/space-service", () => ({
  canManageOrganization: (role: string | undefined) =>
    role === "OWNER" || role === "ADMIN",
  disableOrganizationMember: disableOrganizationMemberMock,
  listOrganizationMembers: listOrganizationMembersMock,
  updateOrganization: updateOrganizationMock,
  updateOrganizationMember: updateOrganizationMemberMock,
}));

vi.mock("./add-org-member-dialog", () => ({
  AddOrgMemberDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-org-member-open" /> : null,
}));

import { OrganizationPage } from "./organization-page";

function makeOrgMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "OM_01",
    organizationId: "ORG_01",
    userId: "USR_01",
    role: "MEMBER",
    status: "ACTIVE",
    user: {
      id: "USR_01",
      name: "Alice",
      username: "alice",
    },
    ...overrides,
  } as unknown as import("@project-delivery/shared").OrganizationMemberWithUser;
}

beforeEach(() => {
  listOrganizationMembersMock.mockReset();
  disableOrganizationMemberMock.mockReset();
  sessionMock.refreshSession.mockReset();
  updateOrganizationMock.mockReset();
  updateOrganizationMemberMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Acme Corp",
      code: "ACME",
      role: "OWNER",
      status: "ACTIVE",
    },
    currentSpace: undefined,
    refreshSession: sessionMock.refreshSession,
    status: "authenticated" as const,
  };
});

afterEach(() => {
  cleanup();
});

describe("OrganizationPage", () => {
  it("renders organization info inputs and the member list", async () => {
    listOrganizationMembersMock.mockResolvedValueOnce({
      items: [
        makeOrgMember({
          user: { id: "U1", name: "Alice", username: "alice" },
        }),
        makeOrgMember({
          id: "OM_02",
          role: "OWNER",
          user: { id: "U2", name: "Bob", username: "bob" },
        }),
      ],
      total: 2,
    });

    render(<OrganizationPage />);

    await waitFor(() =>
      expect(listOrganizationMembersMock).toHaveBeenCalledTimes(1),
    );

    const nameInput = await screen.findByLabelText(
      "organization.info.fields.name",
    );
    expect((nameInput as HTMLInputElement).value).toBe("Acme Corp");
    const codeInput = screen.getByLabelText("organization.info.fields.code");
    expect((codeInput as HTMLInputElement).value).toBe("ACME");
    expect(screen.getByTestId("organization-profile-status")).toHaveValue(
      "ACTIVE",
    );

    // Members render.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(
      screen.getByText("organization.members.roles.OWNER"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("organization.members.roles.MEMBER"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("organization.members.status.ACTIVE").length,
    ).toBeGreaterThan(0);
  });

  it("allows OWNER/ADMIN to update organization profile and refreshes session", async () => {
    listOrganizationMembersMock.mockResolvedValueOnce({ items: [], total: 0 });
    updateOrganizationMock.mockResolvedValueOnce({
      id: "ORG_01",
      name: "Acme Labs",
      code: "ACME-LABS",
      status: "ACTIVE",
    });
    sessionMock.refreshSession.mockResolvedValueOnce(undefined);

    render(<OrganizationPage />);

    await waitFor(() => expect(listOrganizationMembersMock).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("organization-profile-name"), {
      target: { value: "  Acme Labs  " },
    });
    fireEvent.change(screen.getByTestId("organization-profile-code"), {
      target: { value: " ACME-LABS " },
    });

    fireEvent.click(screen.getByTestId("organization-profile-save"));

    await waitFor(() =>
      expect(updateOrganizationMock).toHaveBeenCalledWith("ORG_01", {
        name: "Acme Labs",
        code: "ACME-LABS",
      }),
    );
    expect(sessionMock.refreshSession).toHaveBeenCalledWith(
      "ORG_01",
      undefined,
    );
  });

  it("renders the empty member message when there are no members", async () => {
    listOrganizationMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<OrganizationPage />);

    await waitFor(() => expect(listOrganizationMembersMock).toHaveBeenCalled());
    expect(
      await screen.findByText("organization.members.empty"),
    ).toBeInTheDocument();
  });

  it("renders an error state when the member list rejects", async () => {
    listOrganizationMembersMock.mockRejectedValueOnce(new Error("boom"));

    render(<OrganizationPage />);

    // ErrorState uses mocked translation keys in this test environment.
    expect(
      await screen.findByRole("button", { name: "common.states.retry" }),
    ).toBeInTheDocument();
  });

  it("renders a skeleton loading state while members are loading", async () => {
    let resolve: (value: {
      items: unknown[];
      total: number;
    }) => void = () => {};
    listOrganizationMembersMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    const { container } = render(<OrganizationPage />);

    await waitFor(() => expect(listOrganizationMembersMock).toHaveBeenCalled());
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );

    resolve({ items: [], total: 0 });
    await waitFor(() =>
      expect(
        screen.getByText("organization.members.empty"),
      ).toBeInTheDocument(),
    );
  });

  it("opens the add-member dialog when 添加成员 is clicked", async () => {
    listOrganizationMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<OrganizationPage />);

    await waitFor(() => expect(listOrganizationMembersMock).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole("button", { name: "organization.members.add" }),
    );
    expect(
      await screen.findByTestId("add-org-member-open"),
    ).toBeInTheDocument();
  });

  it("disables the member disable button for the last active OWNER", async () => {
    listOrganizationMembersMock.mockResolvedValueOnce({
      items: [
        makeOrgMember({
          id: "OM_OWNER",
          role: "OWNER",
          user: { id: "U_OWNER", name: "Owner", username: "owner" },
        }),
      ],
      total: 1,
    });

    render(<OrganizationPage />);

    expect(await screen.findByText("Owner")).toBeInTheDocument();
    const disableBtn = screen.getByRole("button", {
      name: "organization.members.actions.disable",
    });
    expect(disableBtn).toBeDisabled();
  });

  it("updates an organization member role", async () => {
    const memberRow = makeOrgMember({
      id: "OM_MEMBER",
      role: "MEMBER",
      user: { id: "U_MEMBER", name: "Mallory", username: "mallory" },
    });
    const updated = makeOrgMember({
      ...memberRow,
      role: "ADMIN",
    });
    listOrganizationMembersMock
      .mockResolvedValueOnce({
        items: [
          makeOrgMember({
            id: "OM_OWNER",
            role: "OWNER",
            user: { id: "U_OWNER", name: "Owner", username: "owner" },
          }),
          memberRow,
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [
          makeOrgMember({
            id: "OM_OWNER",
            role: "OWNER",
            user: { id: "U_OWNER", name: "Owner", username: "owner" },
          }),
          updated,
        ],
        total: 2,
      });
    updateOrganizationMemberMock.mockResolvedValueOnce(updated);

    render(<OrganizationPage />);

    expect(await screen.findByText("Mallory")).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("organization-member-edit-role-OM_MEMBER"),
    );

    fireEvent.change(
      await screen.findByLabelText("organization.dialog.editRole.fields.role"),
      {
        target: { value: "ADMIN" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "organization.dialog.editRole.submit",
      }),
    );

    await waitFor(() =>
      expect(updateOrganizationMemberMock).toHaveBeenCalledWith(
        "ORG_01",
        "OM_MEMBER",
        { role: "ADMIN" },
      ),
    );
    expect(
      await screen.findByText("organization.members.roles.ADMIN"),
    ).toBeInTheDocument();
  });

  it("prevents downgrading the last active OWNER", async () => {
    listOrganizationMembersMock.mockResolvedValueOnce({
      items: [
        makeOrgMember({
          id: "OM_OWNER",
          role: "OWNER",
          user: { id: "U_OWNER", name: "Owner", username: "owner" },
        }),
      ],
      total: 1,
    });

    render(<OrganizationPage />);

    expect(await screen.findByText("Owner")).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("organization-member-edit-role-OM_OWNER"),
    );

    const roleSelect = await screen.findByLabelText(
      "organization.dialog.editRole.fields.role",
    );
    const adminOption = screen.getByRole("option", {
      name: "organization.members.roles.ADMIN",
    });
    expect(adminOption).toBeDisabled();
    fireEvent.change(roleSelect, { target: { value: "ADMIN" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "organization.dialog.editRole.submit",
      }),
    );

    expect(updateOrganizationMemberMock).not.toHaveBeenCalled();
  });

  it("disables an organization member after the user confirms", async () => {
    const memberRow = makeOrgMember({
      id: "OM_MEMBER",
      role: "MEMBER",
      user: { id: "U_MEMBER", name: "Mallory", username: "mallory" },
    });
    const disabledMember = makeOrgMember({
      ...memberRow,
      status: "DISABLED",
    });
    listOrganizationMembersMock.mockResolvedValueOnce({
      items: [
        makeOrgMember({
          id: "OM_OWNER",
          role: "OWNER",
          user: { id: "U_OWNER", name: "Owner", username: "owner" },
        }),
        memberRow,
      ],
      total: 2,
    });
    disableOrganizationMemberMock.mockResolvedValueOnce(disabledMember);

    render(<OrganizationPage />);

    expect(await screen.findByText("Mallory")).toBeInTheDocument();

    const disableButtons = screen.getAllByRole("button", {
      name: "organization.members.actions.disable",
    });
    // First button (OWNER) is disabled (last active owner); second one
    // (MEMBER) should be enabled — click it to open the confirm dialog.
    const memberDisable = disableButtons[1];
    expect(memberDisable).toBeDefined();
    fireEvent.click(memberDisable!);

    const confirm = await screen.findByRole("button", {
      name: "organization.dialog.disableMember.submit",
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(disableOrganizationMemberMock).toHaveBeenCalledWith(
        "ORG_01",
        "OM_MEMBER",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("organization-member-status-OM_MEMBER"),
      ).toHaveTextContent("organization.members.status.DISABLED"),
    );
  });

  it("renders a no-permission empty state for non OWNER/ADMIN organization roles", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
      },
      currentOrganization: {
        id: "ORG_01",
        name: "Acme Corp",
        code: "ACME",
        role: "MEMBER",
        status: "ACTIVE",
      },
      currentSpace: undefined,
      refreshSession: sessionMock.refreshSession,
      status: "authenticated" as const,
    };

    render(<OrganizationPage />);

    expect(
      await screen.findByText("organization.page.noPermission.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("organization.page.noPermission.description"),
    ).toBeInTheDocument();
    expect(listOrganizationMembersMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("organization-add-member-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("organization-profile-name"),
    ).not.toBeInTheDocument();
  });

  it("renders the noOrganization empty state when there is no current organization", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: undefined as unknown as string,
      },
      currentOrganization: null,
      currentSpace: undefined,
      refreshSession: sessionMock.refreshSession,
      status: "authenticated" as const,
    };

    render(<OrganizationPage />);

    expect(
      await screen.findByText("organization.page.noOrganization.title"),
    ).toBeInTheDocument();
    expect(listOrganizationMembersMock).not.toHaveBeenCalled();
  });
});
