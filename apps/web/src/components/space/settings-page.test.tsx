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

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { getSpaceMock, listSpaceMembersMock, updateSpaceMock, updateSpaceMemberMock } =
  vi.hoisted(() => ({
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

vi.mock("./add-space-member-dialog", () => ({
  AddSpaceMemberDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-space-member-open" /> : null,
}));
vi.mock("./edit-space-member-role-dialog", () => ({
  EditSpaceMemberRoleDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-role-dialog-open" /> : null,
}));

import { SpaceSettingsPage } from "./settings-page";

function makeSpace(overrides: Record<string, unknown> = {}) {
  return {
    id: "SPC_01",
    organizationId: "ORG_01",
    code: "SPC-A",
    name: "Space A",
    settings: { staleThresholdDays: 3 },
    ...overrides,
  } as unknown as import("@project-delivery/shared").Space;
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "SPM_01",
    userId: "USR_01",
    role: "DEVELOPER",
    status: "ACTIVE",
    spaceId: "SPC_01",
    user: {
      id: "USR_01",
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
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
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
      items: [makeMember({ user: { id: "U1", name: "Alice", username: "alice" } })],
      total: 1,
    });

    render(<SpaceSettingsPage />);

    await waitFor(() => expect(getSpaceMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(listSpaceMembersMock).toHaveBeenCalledTimes(1),
    );

    // Name input populated.
    const nameInput = await screen.findByLabelText(
      "spaceSettings.basic.fields.name",
    );
    expect((nameInput as HTMLInputElement).value).toBe("Space A");

    // Member row.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("renders the empty member list message when there are no members", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    await waitFor(() =>
      expect(listSpaceMembersMock).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText("spaceSettings.members.empty"),
    ).toBeInTheDocument();
  });

  it("renders an error state when the load rejects", async () => {
    getSpaceMock.mockRejectedValueOnce(new Error("boom"));
    listSpaceMembersMock.mockRejectedValueOnce(new Error("boom"));

    render(<SpaceSettingsPage />);

    // ErrorState built-in defaults render "重试" button.
    expect(
      await screen.findByRole("button", { name: "重试" }),
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
    expect(
      container.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);

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

    await waitFor(() =>
      expect(listSpaceMembersMock).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "spaceSettings.members.add" }),
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
      currentSpace: undefined as unknown as never,
      status: "authenticated" as const,
    };

    render(<SpaceSettingsPage />);

    expect(
      await screen.findByText("spaceSettings.page.noSpace.title"),
    ).toBeInTheDocument();
    expect(getSpaceMock).not.toHaveBeenCalled();
  });
});
