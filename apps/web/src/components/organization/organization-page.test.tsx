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
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Acme Corp",
      code: "ACME",
    },
    status: "authenticated" as const,
  } as { session: unknown; currentOrganization: unknown; status: string },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { listOrganizationMembersMock, removeOrganizationMemberMock } = vi.hoisted(
  () => ({
    listOrganizationMembersMock: vi.fn(),
    removeOrganizationMemberMock: vi.fn(),
  }),
);
vi.mock("../../lib/space-service", () => ({
  listOrganizationMembers: listOrganizationMembersMock,
  removeOrganizationMember: removeOrganizationMemberMock,
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
  removeOrganizationMemberMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Acme Corp",
      code: "ACME",
    },
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

    // Org info readonly inputs.
    const nameInput = await screen.findByLabelText(
      "organization.info.fields.name",
    );
    expect((nameInput as HTMLInputElement).value).toBe("Acme Corp");
    const codeInput = screen.getByLabelText(
      "organization.info.fields.code",
    );
    expect((codeInput as HTMLInputElement).value).toBe("ACME");

    // Members render.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // Role badges render the raw role string.
    expect(screen.getByText("OWNER")).toBeInTheDocument();
    expect(screen.getByText("MEMBER")).toBeInTheDocument();
  });

  it("renders the empty member message when there are no members", async () => {
    listOrganizationMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<OrganizationPage />);

    await waitFor(() =>
      expect(listOrganizationMembersMock).toHaveBeenCalled(),
    );
    expect(
      await screen.findByText("organization.members.empty"),
    ).toBeInTheDocument();
  });

  it("renders an error state when the member list rejects", async () => {
    listOrganizationMembersMock.mockRejectedValueOnce(new Error("boom"));

    render(<OrganizationPage />);

    // ErrorState built-in defaults render a 重试 button.
    expect(
      await screen.findByRole("button", { name: "重试" }),
    ).toBeInTheDocument();
  });

  it("renders a skeleton loading state while members are loading", async () => {
    let resolve: (value: { items: unknown[]; total: number }) => void = () => {};
    listOrganizationMembersMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    const { container } = render(<OrganizationPage />);

    await waitFor(() =>
      expect(listOrganizationMembersMock).toHaveBeenCalled(),
    );
    expect(
      container.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);

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

    await waitFor(() =>
      expect(listOrganizationMembersMock).toHaveBeenCalled(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "organization.members.add" }),
    );
    expect(
      await screen.findByTestId("add-org-member-open"),
    ).toBeInTheDocument();
  });

  it("disables the remove button for the last active OWNER", async () => {
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
    const removeBtn = screen.getByRole("button", {
      name: "organization.members.actions.remove",
    });
    expect(removeBtn).toBeDisabled();
  });

  it("calls removeOrganizationMember after the user confirms removal", async () => {
    const memberRow = makeOrgMember({
      id: "OM_MEMBER",
      role: "MEMBER",
      user: { id: "U_MEMBER", name: "Mallory", username: "mallory" },
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
    removeOrganizationMemberMock.mockResolvedValueOnce(undefined);

    render(<OrganizationPage />);

    expect(await screen.findByText("Mallory")).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button", {
      name: "organization.members.actions.remove",
    });
    // First button (OWNER) is disabled (last active owner); second one
    // (MEMBER) should be enabled — click it to open the confirm dialog.
    const memberRemove = removeButtons[1];
    expect(memberRemove).toBeDefined();
    fireEvent.click(memberRemove!);

    const confirm = await screen.findByRole("button", {
      name: "organization.dialog.removeMember.submit",
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(removeOrganizationMemberMock).toHaveBeenCalledWith(
        "ORG_01",
        "OM_MEMBER",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Mallory")).not.toBeInTheDocument(),
    );
  });

  it("renders the noOrganization empty state when there is no current organization", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: undefined as unknown as string,
      },
      currentOrganization: null,
      status: "authenticated" as const,
    };

    render(<OrganizationPage />);

    expect(
      await screen.findByText("organization.page.noOrganization.title"),
    ).toBeInTheDocument();
    expect(listOrganizationMembersMock).not.toHaveBeenCalled();
  });
});
