import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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
          user: {
            id: "USR_CURRENT",
          },
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
  createTagMock,
  listTagsMock,
  deleteTagMock,
  mergeTagsMock,
} = vi.hoisted(() => ({
  getSpaceMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  updateSpaceMock: vi.fn(),
  updateSpaceMemberMock: vi.fn(),
  createTagMock: vi.fn(),
  listTagsMock: vi.fn(),
  deleteTagMock: vi.fn(),
  mergeTagsMock: vi.fn(),
}));
vi.mock("../../lib/space-service", () => ({
  getSpace: getSpaceMock,
  listSpaceMembers: listSpaceMembersMock,
  updateSpace: updateSpaceMock,
  updateSpaceMember: updateSpaceMemberMock,
}));
vi.mock("../../lib/tag-service", () => ({
  createTag: createTagMock,
  deleteTag: deleteTagMock,
  listTags: listTagsMock,
  mergeTags: mergeTagsMock,
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
  EditSpaceMemberRoleDialog: ({
    member,
    onSuccess,
    open,
  }: {
    member: import("@project-delivery/shared").SpaceMemberWithUser | null;
    onSuccess: (
      member: import("@project-delivery/shared").SpaceMemberWithUser,
    ) => void;
    open: boolean;
  }) =>
    open && member ? (
      <button
        data-testid="edit-role-dialog-submit"
        onClick={() => onSuccess({ ...member, role: "VIEWER" })}
        type="button"
      >
        edit-role-dialog-open
      </button>
    ) : null,
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

function makeTag(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FTG",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    name: "backend",
    displayName: "#backend",
    normalizedName: "backend",
    colorKey: "blue",
    usageCount: 2,
    isOrphan: false,
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
    ...overrides,
  } as unknown as import("@project-delivery/shared").TagDto;
}

beforeEach(() => {
  getSpaceMock.mockReset();
  listSpaceMembersMock.mockReset();
  updateSpaceMock.mockReset();
  updateSpaceMemberMock.mockReset();
  createTagMock.mockReset();
  listTagsMock.mockReset();
  deleteTagMock.mockReset();
  mergeTagsMock.mockReset();
  refreshSessionMock.mockReset();
  listTagsMock.mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 100,
    total: 0,
  });
  deleteTagMock.mockResolvedValue({});
  mergeTagsMock.mockResolvedValue({
    targetTag: makeTag({
      id: "01ARZ3NDEKTSV4RRFFQ69G5F99",
      name: "frontend",
      displayName: "#frontend",
      normalizedName: "frontend",
    }),
    sourceTags: [makeTag()],
    dryRun: true,
    sourceAssignmentsRemoved: 0,
    targetAssignmentsCreated: 0,
    duplicateAssignmentsSkipped: 0,
    deletedSourceTags: 0,
    affectedTargetsByType: [],
  });
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      user: {
        id: "USR_CURRENT",
      },
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

  it("renders the overview card with organization, active member count, and role", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [
        makeMember(),
        makeMember({
          id: "SPM_DISABLED",
          userId: "01ARZ3NDEKTSV4RRFFQ69G5F02",
          status: "DISABLED",
          user: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
            name: "Bob",
            username: "bob",
          },
        }),
      ],
      total: 2,
    });

    render(<SpaceSettingsPage />);

    const overview = await screen.findByTestId("space-settings-overview");
    expect(screen.getByText("Acme Org")).toBeInTheDocument();
    expect(within(overview).getByText("1")).toBeInTheDocument();
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

  it("exposes accessible names for member search and role filtering", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [makeMember()],
      total: 1,
    });

    render(<SpaceSettingsPage />);

    expect(
      await screen.findByLabelText("spaceSettings.members.searchLabel"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("spaceSettings.members.roleFilterLabel"),
    ).toBeInTheDocument();
  });

  it("shows a tooltip for the change space role icon button", async () => {
    const user = userEvent.setup();
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [makeMember()],
      total: 1,
    });

    render(<SpaceSettingsPage />);

    const editRoleButton = await screen.findByTestId(
      "space-settings-member-edit-SPM_01",
    );
    const tooltipTrigger = editRoleButton.closest(
      "[data-state]",
    ) as HTMLElement;

    expect(tooltipTrigger).toBeInTheDocument();
    await user.hover(tooltipTrigger);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "spaceSettings.members.actions.changeRole",
    );
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
        user: {
          id: "USR_CURRENT",
        },
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
    expect(listTagsMock).not.toHaveBeenCalled();
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

  it("submits null values when clearing owner and description", async () => {
    getSpaceMock.mockResolvedValueOnce(
      makeSpace({
        description: "Old description",
        ownerId: OWNER_ID,
      }),
    );
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [makeMember()],
      total: 1,
    });
    updateSpaceMock.mockResolvedValueOnce(makeSpace());

    render(<SpaceSettingsPage />);

    const description = await screen.findByTestId(
      "space-settings-description-input",
    );
    const owner = await screen.findByTestId("space-settings-owner-input");

    fireEvent.change(description, { target: { value: "" } });
    fireEvent.change(owner, { target: { value: "" } });

    fireEvent.click(screen.getByTestId("space-settings-basic-submit"));

    await waitFor(() => expect(updateSpaceMock).toHaveBeenCalledTimes(1));
    expect(updateSpaceMock).toHaveBeenCalledWith("SPC_01", {
      name: "Space A",
      code: "SPC-A",
      description: null,
      ownerId: null,
    });
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

  it("maps local basic form validation to a field-level message", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    const codeInput = await screen.findByTestId("space-settings-code-input");
    fireEvent.change(codeInput, { target: { value: "bad code!" } });
    fireEvent.click(screen.getByTestId("space-settings-basic-submit"));

    expect(
      await screen.findByTestId("space-settings-code-error"),
    ).toHaveTextContent("spaceSettings.basic.errors.codeInvalid");
    expect(updateSpaceMock).not.toHaveBeenCalled();
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

  it("renders current-space tags with usage, created time, and orphan status", async () => {
    listTagsMock.mockResolvedValueOnce({
      items: [makeTag()],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    await waitFor(() =>
      expect(listTagsMock).toHaveBeenCalledWith({
        includeUsage: true,
        organizationId: "ORG_01",
        page: 1,
        pageSize: 100,
        query: undefined,
        spaceId: "SPC_01",
      }),
    );
    expect(await screen.findByText("#backend")).toBeInTheDocument();
    expect(
      screen.getByText("spaceSettings.tags.status.inUse"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        new Intl.DateTimeFormat("zh-CN", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date("2026-05-19T10:00:00.000Z")),
      ),
    ).toBeInTheDocument();
  });

  it("searches tags by name from the space settings tag section", async () => {
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    await screen.findByLabelText("spaceSettings.tags.searchLabel");

    const user = userEvent.setup();
    await user.type(screen.getByTestId("space-settings-tag-search"), "back");

    await waitFor(() =>
      expect(listTagsMock).toHaveBeenLastCalledWith({
        includeUsage: true,
        organizationId: "ORG_01",
        page: 1,
        pageSize: 100,
        query: "back",
        spaceId: "SPC_01",
      }),
    );
  });

  it("opens orphan tag delete confirmation, cancels without deleting, and confirms deletion", async () => {
    const tag = makeTag({
      id: "01ARZ3NDEKTSV4RRFFQ69G5F00",
      name: "unused",
      displayName: "#unused",
      normalizedName: "unused",
      usageCount: 0,
      isOrphan: true,
    });
    listTagsMock
      .mockResolvedValueOnce({
        items: [tag],
        page: 1,
        pageSize: 100,
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [],
        page: 1,
        pageSize: 100,
        total: 0,
      });
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    const deleteButton = await screen.findByTestId(
      "space-settings-tag-delete-01ARZ3NDEKTSV4RRFFQ69G5F00",
    );
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("dialog", {
      name: "spaceSettings.dialog.deleteOrphanTag.title",
    });
    expect(
      within(dialog).getByText(
        "spaceSettings.dialog.deleteOrphanTag.description",
      ),
    ).toBeInTheDocument();
    expect(deleteTagMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "spaceSettings.dialog.deleteOrphanTag.cancel",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "spaceSettings.dialog.deleteOrphanTag.title",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(deleteTagMock).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByTestId(
        "space-settings-tag-delete-01ARZ3NDEKTSV4RRFFQ69G5F00",
      ),
    );
    fireEvent.click(
      within(
        await screen.findByRole("dialog", {
          name: "spaceSettings.dialog.deleteOrphanTag.title",
        }),
      ).getByRole("button", {
        name: "spaceSettings.dialog.deleteOrphanTag.submit",
      }),
    );

    await waitFor(() =>
      expect(deleteTagMock).toHaveBeenCalledWith("01ARZ3NDEKTSV4RRFFQ69G5F00"),
    );
    await waitFor(() => expect(listTagsMock).toHaveBeenCalledTimes(2));
  });

  it("previews and confirms merging multiple source tags into a target tag", async () => {
    const user = userEvent.setup();
    const sourceTag = makeTag({
      id: "01ARZ3NDEKTSV4RRFFQ69G5F00",
      name: "backend",
      displayName: "#backend",
      normalizedName: "backend",
      usageCount: 3,
    });
    const secondSourceTag = makeTag({
      id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
      name: "api",
      displayName: "#api",
      normalizedName: "api",
      usageCount: 4,
    });
    const targetTag = makeTag({
      id: "01ARZ3NDEKTSV4RRFFQ69G5F99",
      name: "frontend",
      displayName: "#frontend",
      normalizedName: "frontend",
      usageCount: 5,
    });
    listTagsMock
      .mockResolvedValueOnce({
        items: [sourceTag, secondSourceTag, targetTag],
        page: 1,
        pageSize: 100,
        total: 3,
      })
      .mockResolvedValue({
        items: [sourceTag, secondSourceTag, targetTag],
        page: 1,
        pageSize: 20,
        total: 3,
      });
    mergeTagsMock
      .mockResolvedValueOnce({
        targetTag,
        sourceTags: [sourceTag, secondSourceTag],
        dryRun: true,
        sourceAssignmentsRemoved: 7,
        targetAssignmentsCreated: 5,
        duplicateAssignmentsSkipped: 1,
        deletedSourceTags: 0,
        affectedTargetsByType: [{ targetType: "WORK_ITEM", count: 3 }],
      })
      .mockResolvedValueOnce({
        targetTag,
        sourceTags: [sourceTag, secondSourceTag],
        dryRun: false,
        sourceAssignmentsRemoved: 7,
        targetAssignmentsCreated: 5,
        duplicateAssignmentsSkipped: 1,
        deletedSourceTags: 2,
        affectedTargetsByType: [{ targetType: "WORK_ITEM", count: 3 }],
      });
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    await user.click(
      await screen.findByTestId(
        "space-settings-tag-merge-01ARZ3NDEKTSV4RRFFQ69G5F00",
      ),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "spaceSettings.dialog.mergeTag.title",
    });
    expect(
      within(dialog).getByText("spaceSettings.dialog.mergeTag.warning"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId(
        "space-settings-tag-merge-source-01ARZ3NDEKTSV4RRFFQ69G5F00",
      ),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByTestId(
        "space-settings-tag-merge-source-picker-input",
      ),
    );
    await user.click(
      within(
        await screen.findByTestId(
          "space-settings-tag-merge-source-picker-panel",
        ),
      ).getByText("#api"),
    );
    expect(
      within(dialog).getByTestId(
        "space-settings-tag-merge-source-01ARZ3NDEKTSV4RRFFQ69G5F01",
      ),
    ).toBeInTheDocument();

    await user.click(
      within(
        within(dialog).getByTestId(
          "space-settings-tag-merge-source-01ARZ3NDEKTSV4RRFFQ69G5F01",
        ),
      ).getByRole("button", { name: "tags.badge.remove" }),
    );
    expect(
      within(dialog).queryByTestId(
        "space-settings-tag-merge-source-01ARZ3NDEKTSV4RRFFQ69G5F01",
      ),
    ).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByTestId(
        "space-settings-tag-merge-source-picker-input",
      ),
    );
    await user.click(
      within(
        await screen.findByTestId(
          "space-settings-tag-merge-source-picker-panel",
        ),
      ).getByText("#api"),
    );

    await user.click(
      within(dialog).getByTestId(
        "space-settings-tag-merge-target-picker-input",
      ),
    );
    const targetPanel = await screen.findByTestId(
      "space-settings-tag-merge-target-picker-panel",
    );
    expect(within(targetPanel).queryByText("#backend")).not.toBeInTheDocument();
    expect(within(targetPanel).queryByText("#api")).not.toBeInTheDocument();
    await user.click(within(targetPanel).getByText("#frontend"));

    await waitFor(() =>
      expect(mergeTagsMock).toHaveBeenCalledWith({
        dryRun: true,
        organizationId: "ORG_01",
        sourceTagIds: [
          "01ARZ3NDEKTSV4RRFFQ69G5F00",
          "01ARZ3NDEKTSV4RRFFQ69G5F01",
        ],
        targetTagId: "01ARZ3NDEKTSV4RRFFQ69G5F99",
        spaceId: "SPC_01",
      }),
    );
    expect(
      within(screen.getByTestId("space-settings-tag-merge-preview")).getByText(
        "spaceSettings.dialog.mergeTag.metrics.created",
      ),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", {
        name: "spaceSettings.dialog.mergeTag.submit",
      }),
    );

    await waitFor(() =>
      expect(mergeTagsMock).toHaveBeenLastCalledWith({
        dryRun: false,
        organizationId: "ORG_01",
        sourceTagIds: [
          "01ARZ3NDEKTSV4RRFFQ69G5F00",
          "01ARZ3NDEKTSV4RRFFQ69G5F01",
        ],
        targetTagId: "01ARZ3NDEKTSV4RRFFQ69G5F99",
        spaceId: "SPC_01",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "spaceSettings.dialog.mergeTag.title",
        }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        listTagsMock.mock.calls.filter(([input]) => input.pageSize === 100),
      ).toHaveLength(2),
    );
  });

  it("disables the orphan tag delete confirmation while deletion is pending", async () => {
    const tag = makeTag({
      usageCount: 0,
      isOrphan: true,
    });
    let resolveDelete: (value: unknown) => void = () => {};
    listTagsMock.mockResolvedValue({
      items: [tag],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    deleteTagMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    fireEvent.click(
      await screen.findByTestId(
        "space-settings-tag-delete-01ARZ3NDEKTSV4RRFFQ69G5FTG",
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "spaceSettings.dialog.deleteOrphanTag.title",
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "spaceSettings.dialog.deleteOrphanTag.submit",
      }),
    );

    expect(
      await within(dialog).findByRole("button", {
        name: "spaceSettings.dialog.deleteOrphanTag.submitting",
      }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", {
        name: "spaceSettings.dialog.deleteOrphanTag.cancel",
      }),
    ).toBeDisabled();

    resolveDelete({});
    await waitFor(() => expect(deleteTagMock).toHaveBeenCalledTimes(1));
  });

  it("hides orphan tag delete actions for non-manager space roles", async () => {
    sessionMock.current.currentSpace = {
      ...sessionMock.current.currentSpace!,
      role: "VIEWER",
    };
    listTagsMock.mockResolvedValueOnce({
      items: [
        makeTag({
          usageCount: 0,
          isOrphan: true,
        }),
      ],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    expect(await screen.findByText("#backend")).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "space-settings-tag-delete-01ARZ3NDEKTSV4RRFFQ69G5FTG",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "space-settings-tag-merge-01ARZ3NDEKTSV4RRFFQ69G5FTG",
      ),
    ).not.toBeInTheDocument();
  });

  it("refreshes tags and shows the API message when delete finds the tag in use", async () => {
    const tag = makeTag({
      usageCount: 0,
      isOrphan: true,
    });
    listTagsMock.mockResolvedValue({
      items: [tag],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    deleteTagMock.mockRejectedValueOnce(
      new FakeApiClientError("TAG_IN_USE", 409),
    );
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpaceSettingsPage />);

    fireEvent.click(
      await screen.findByTestId(
        "space-settings-tag-delete-01ARZ3NDEKTSV4RRFFQ69G5FTG",
      ),
    );
    fireEvent.click(
      within(
        await screen.findByRole("dialog", {
          name: "spaceSettings.dialog.deleteOrphanTag.title",
        }),
      ).getByRole("button", {
        name: "spaceSettings.dialog.deleteOrphanTag.submit",
      }),
    );

    expect(
      await screen.findByText("errors.api.TAG_IN_USE"),
    ).toBeInTheDocument();
    await waitFor(() => expect(listTagsMock).toHaveBeenCalledTimes(2));
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

  it("refreshes the app session when the current user's space role changes", async () => {
    const selfMember = makeMember({
      id: "SPM_SELF",
      userId: "USR_CURRENT",
      role: "PM",
      user: { id: "USR_CURRENT", name: "Current User", username: "current" },
    });
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [selfMember],
      total: 1,
    });
    refreshSessionMock.mockResolvedValueOnce(undefined);

    render(<SpaceSettingsPage />);

    expect(await screen.findByText("Current User")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("space-settings-member-edit-SPM_SELF"));
    fireEvent.click(await screen.findByTestId("edit-role-dialog-submit"));

    await waitFor(() =>
      expect(refreshSessionMock).toHaveBeenCalledWith("ORG_01", "SPC_01"),
    );
  });

  it("refreshes the app session without the disabled space when the current user is disabled", async () => {
    const selfMember = makeMember({
      id: "SPM_SELF",
      userId: "USR_CURRENT",
      user: { id: "USR_CURRENT", name: "Current User", username: "current" },
    });
    getSpaceMock.mockResolvedValueOnce(makeSpace());
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [selfMember],
      total: 1,
    });
    updateSpaceMemberMock.mockResolvedValueOnce(
      makeMember({
        ...selfMember,
        status: "DISABLED",
      }),
    );
    refreshSessionMock.mockResolvedValueOnce(undefined);

    render(<SpaceSettingsPage />);

    expect(await screen.findByText("Current User")).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("space-settings-member-disable-SPM_SELF"),
    );

    await waitFor(() =>
      expect(updateSpaceMemberMock).toHaveBeenCalledWith("SPC_01", "SPM_SELF", {
        status: "DISABLED",
      }),
    );
    expect(refreshSessionMock).toHaveBeenCalledWith("ORG_01", undefined);
  });
});
