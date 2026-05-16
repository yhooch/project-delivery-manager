import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------------
// next-intl translator: stable per-namespace function, returns "ns.key".
// -----------------------------------------------------------------------------
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

const { routerPushMock, routerReplaceMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  routerReplaceMock: vi.fn(),
}));
vi.mock("../../i18n/routing", () => ({
  routing: { defaultLocale: "zh-CN", locales: ["zh-CN", "en-US"] },
  Link: ({
    children,
    href,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/requirements",
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      user: {
        id: "USER_01",
        name: "Requirement User",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
        status: "ACTIVE",
        username: "requirement",
      },
      spaces: [
        {
          id: "SPC_01",
          organizationId: "ORG_01",
          name: "Space",
          role: "PM",
          status: "ACTIVE",
        },
      ],
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space",
      role: "PM",
      status: "ACTIVE",
    },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const {
  listRequirementsMock,
  createRequirementDraftMock,
  listRequirementAssignableMembersMock,
  listRequirementVersionsMock,
} = vi.hoisted(() => ({
  listRequirementsMock: vi.fn(),
  createRequirementDraftMock: vi.fn(),
  listRequirementAssignableMembersMock: vi.fn(),
  listRequirementVersionsMock: vi.fn(),
}));
vi.mock("../../lib/requirement-service", () => ({
  listRequirements: listRequirementsMock,
  createRequirementDraft: createRequirementDraftMock,
  listRequirementAssignableMembers: listRequirementAssignableMembersMock,
  listRequirementVersions: listRequirementVersionsMock,
}));

import { RequirementsPage } from "./requirements-page";
import {
  LOCAL_DRAFT_CACHE_VERSION,
  createRequirementDraftLocalCacheKey,
} from "../../lib/requirement-draft-local-cache";
import { createRecentStorageKey } from "../shell/recent-opens";

function makeRequirement(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Authentication refresh",
    summary: "Refresh login + register flow with magic link",
    status: "DRAFT",
    versionId: "01ARZ3NDEKTSV4RRFFQ69G5FD1",
    ownerId: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
    relatedWorkItems: { taskCount: 2, bugCount: 1 },
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...overrides,
  } as unknown as import("@project-delivery/shared").Requirement;
}

beforeEach(() => {
  listRequirementsMock.mockReset();
  createRequirementDraftMock.mockReset();
  listRequirementAssignableMembersMock.mockReset();
  listRequirementVersionsMock.mockReset();
  routerPushMock.mockReset();
  routerReplaceMock.mockReset();
  listRequirementAssignableMembersMock.mockResolvedValue({
    items: [],
    total: 0,
  });
  listRequirementVersionsMock.mockResolvedValue({
    items: [],
    total: 0,
  });
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      user: {
        id: "USER_01",
        name: "Requirement User",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
        status: "ACTIVE",
        username: "requirement",
      },
      spaces: [
        {
          id: "SPC_01",
          organizationId: "ORG_01",
          name: "Space",
          role: "PM",
          status: "ACTIVE",
        },
      ],
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space",
      role: "PM",
      status: "ACTIVE",
    },
    status: "authenticated" as const,
  };
  searchParamsMock.current = new URLSearchParams();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("RequirementsPage", () => {
  it("creates a draft and navigates from the command palette query", async () => {
    searchParamsMock.current = new URLSearchParams("new=requirement");
    listRequirementsMock.mockResolvedValueOnce({ items: [], total: 0 });
    createRequirementDraftMock.mockResolvedValueOnce(
      makeRequirement({ id: "01ARZ3NDEKTSV4RRFFQ69G5FCMD" }),
    );

    render(<RequirementsPage />);

    await waitFor(() =>
      expect(createRequirementDraftMock).toHaveBeenCalledWith(
        { organizationId: "ORG_01", spaceId: "SPC_01" },
        {},
      ),
    );
    expect(routerPushMock).toHaveBeenCalledWith(
      "/requirements/01ARZ3NDEKTSV4RRFFQ69G5FCMD",
    );
    expect(routerReplaceMock).toHaveBeenCalledWith("/requirements", {
      scroll: false,
    });
  });

  it("does not auto-create a draft from the query without requirement write role", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space",
        role: "DEVELOPER",
        status: "ACTIVE",
      },
    };
    searchParamsMock.current = new URLSearchParams("new=requirement");
    listRequirementsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<RequirementsPage />);

    await waitFor(() =>
      expect(routerReplaceMock).toHaveBeenCalledWith("/requirements", {
        scroll: false,
      }),
    );
    expect(createRequirementDraftMock).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId("requirements-create-readonly-notice"),
    ).toHaveTextContent("requirements.page.createReadonly");
    expect(screen.getByTestId("requirements-create-button")).toBeDisabled();
  });

  it("renders requirement rows with title and status badge", async () => {
    listRequirementVersionsMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FD1",
          name: "M1 Release",
        },
      ],
      total: 1,
    });
    listRequirementAssignableMembersMock.mockResolvedValueOnce({
      items: [
        {
          id: "MEMBER_01",
          organizationId: "ORG_01",
          role: "PM",
          spaceId: "SPC_01",
          status: "ACTIVE",
          user: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
            name: "PM User",
            status: "ACTIVE",
            username: "pm",
          },
          userId: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
        },
      ],
      total: 1,
    });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
          title: "Onboarding redesign",
          status: "CONFIRMED",
        }),
      ],
      total: 1,
    });

    render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalledTimes(1));
    expect(listRequirementsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 100,
        spaceId: "SPC_01",
        status: "CONFIRMED",
      }),
    );
    expect(listRequirementsMock.mock.calls[0][0]).not.toMatchObject({
      includeDrafts: true,
    });
    expect(await screen.findByText("Onboarding redesign")).toBeInTheDocument();
    expect(
      screen.getByText("requirements.status.CONFIRMED"),
    ).toBeInTheDocument();
    expect(await screen.findByText("M1 Release")).toBeInTheDocument();
    expect(screen.queryByText("PM User (pm)")).not.toBeInTheDocument();
    // The list renders with the testid.
    expect(screen.getByTestId("requirements-list")).toBeInTheDocument();
  });

  it("renders requirement status totals from the paged list response", async () => {
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          title: "Loaded requirement",
          status: "CONFIRMED",
        }),
      ],
      statusCounts: [
        { status: "DRAFT", count: 3 },
        { status: "CONFIRMED", count: 8 },
        { status: "ARCHIVED", count: 2 },
      ],
      total: 10,
    });

    render(<RequirementsPage />);

    expect(await screen.findByText("Loaded requirement")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("button", { name: /requirements\.filters\.active/ }),
      ).getByText("8"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("button", { name: /requirements\.filters\.draft/ }),
      ).getByText("3"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("button", { name: /requirements\.filters\.all/ }),
      ).getByText("13"),
    ).toBeInTheDocument();
  });

  it("marks the active requirement option for keyboard navigation", async () => {
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FK1",
          title: "First semantic requirement",
          status: "CONFIRMED",
        }),
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FK2",
          title: "Second semantic requirement",
          status: "CONFIRMED",
        }),
      ],
      total: 2,
    });

    render(<RequirementsPage />);

    expect(
      await screen.findByRole("listbox", { name: "requirements.list.title" }),
    ).toBeInTheDocument();
    const firstOption = screen.getByRole("option", {
      name: /First semantic requirement/u,
    });
    const secondOption = screen.getByRole("option", {
      name: /Second semantic requirement/u,
    });
    expect(firstOption).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() =>
      expect(firstOption).toHaveAttribute("aria-selected", "true"),
    );
    await waitFor(() => expect(firstOption).toHaveFocus());

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() =>
      expect(secondOption).toHaveAttribute("aria-selected", "true"),
    );

    fireEvent.keyDown(window, { key: "Enter" });
    expect(routerPushMock).toHaveBeenCalledWith(
      "/requirements/01ARZ3NDEKTSV4RRFFQ69G5FK2",
    );
  });

  it("renders the empty state when there are no requirements (active filter)", async () => {
    listRequirementsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalled());
    expect(
      await screen.findByText("requirements.states.empty.title"),
    ).toBeInTheDocument();
  });

  it("renders the error state when listRequirements rejects", async () => {
    listRequirementsMock.mockRejectedValueOnce(new Error("boom"));

    render(<RequirementsPage />);

    expect(
      await screen.findByText("requirements.states.errorTitle"),
    ).toBeInTheDocument();
  });

  it("shows a loading skeleton while the requirements request is pending", async () => {
    let resolveList: (value: {
      items: unknown[];
      total: number;
    }) => void = () => {};
    listRequirementsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const { container } = render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalled());
    // ListSkeleton renders animate-pulse rows; the list itself is not yet present.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByTestId("requirements-list")).not.toBeInTheDocument();

    // Resolve so afterEach cleanup doesn't fight pending state.
    resolveList({ items: [], total: 0 });
    await waitFor(() =>
      expect(
        screen.getByText("requirements.states.empty.title"),
      ).toBeInTheDocument(),
    );
  });

  it("filters by ARCHIVED bucket through the list API when the user clicks it", async () => {
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
          title: "Current scope",
          status: "CONFIRMED",
        }),
      ],
      total: 1,
    });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
          title: "Old shipped",
          status: "ARCHIVED",
        }),
      ],
      total: 1,
    });

    render(<RequirementsPage />);

    expect(await screen.findByText("Current scope")).toBeInTheDocument();
    expect(screen.queryByText("Old shipped")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /requirements\.filters\.archived/ }),
    );

    await waitFor(() =>
      expect(listRequirementsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          spaceId: "SPC_01",
          status: "ARCHIVED",
        }),
      ),
    );
    expect(await screen.findByText("Old shipped")).toBeInTheDocument();
    expect(screen.queryByText("Current scope")).not.toBeInTheDocument();
  });

  it("loads the current user's drafts through the DRAFT entry", async () => {
    listRequirementsMock.mockResolvedValueOnce({ items: [], total: 0 });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F03",
          title: "My draft",
          status: "DRAFT",
        }),
      ],
      total: 1,
    });

    render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.actions.myDrafts" }),
    );

    await waitFor(() =>
      expect(listRequirementsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          includeDrafts: true,
          spaceId: "SPC_01",
          status: "DRAFT",
        }),
      ),
    );
    expect(await screen.findByText("My draft")).toBeInTheDocument();
  });

  it("renders blank draft rows with the draft-specific untitled label", async () => {
    listRequirementsMock.mockResolvedValueOnce({ items: [], total: 0 });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FD0",
          status: "DRAFT",
          summary: undefined,
          title: "",
        }),
      ],
      total: 1,
    });

    render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.actions.myDrafts" }),
    );

    expect(
      await screen.findByText("requirements.list.untitledDraft"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("requirements.list.untitled"),
    ).not.toBeInTheDocument();
  });

  it("uses the browser draft cache title and summary in the draft list", async () => {
    const draftId = "01ARZ3NDEKTSV4RRFFQ69G5FDC";
    window.localStorage.setItem(
      createRequirementDraftLocalCacheKey({
        organizationId: "ORG_01",
        requirementId: draftId,
        spaceId: "SPC_01",
        userId: "USER_01",
      }),
      JSON.stringify({
        cachedAt: "2026-05-12T00:01:00.000Z",
        form: {
          content: {
            contentJson: { type: "doc", content: [] },
            contentMarkdownCache: "",
            contentText: "",
          },
          ownerId: "",
          priority: "",
          summary: "本机未保存摘要",
          title: "本机未保存标题",
          versionId: "",
        },
        requirementUpdatedAt: "2026-05-12T00:00:00.000Z",
        version: LOCAL_DRAFT_CACHE_VERSION,
      }),
    );
    listRequirementsMock.mockResolvedValueOnce({ items: [], total: 0 });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: draftId,
          status: "DRAFT",
          summary: undefined,
          title: "",
          updatedAt: "2026-05-12T00:00:00.000Z",
        }),
      ],
      total: 1,
    });

    render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.actions.myDrafts" }),
    );

    expect(await screen.findByText("本机未保存标题")).toBeInTheDocument();
    expect(screen.getByText("本机未保存摘要")).toBeInTheDocument();
    expect(
      screen.getByText("requirements.list.localDraftCache"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("本机未保存标题"));

    const stored = JSON.parse(
      window.localStorage.getItem(
        createRecentStorageKey({
          organizationId: "ORG_01",
          spaceId: "SPC_01",
        }),
      ) ?? "[]",
    ) as Array<{ href: string; title: string; type: string }>;
    expect(stored[0]).toMatchObject({
      href: `/requirements/${draftId}`,
      title: "本机未保存标题",
      type: "REQUIREMENT",
    });
  });

  it("includes drafts when the user selects the all bucket", async () => {
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F04",
          title: "Confirmed requirement",
          status: "CONFIRMED",
        }),
      ],
      total: 1,
    });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F05",
          title: "Visible draft",
          status: "DRAFT",
        }),
      ],
      total: 1,
    });

    render(<RequirementsPage />);

    expect(
      await screen.findByText("Confirmed requirement"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /requirements\.filters\.all/ }),
    );

    await waitFor(() =>
      expect(listRequirementsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          includeDrafts: true,
          spaceId: "SPC_01",
        }),
      ),
    );
    expect(await screen.findByText("Visible draft")).toBeInTheDocument();
  });

  it("applies version and owner filters from the filter panel", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FD1";
    const ownerId = "01ARZ3NDEKTSV4RRFFQ69G5FU1";

    listRequirementVersionsMock.mockResolvedValueOnce({
      items: [{ id: versionId, name: "M1" }],
      total: 1,
    });
    listRequirementAssignableMembersMock.mockResolvedValueOnce({
      items: [
        {
          id: "MEMBER_01",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          userId: ownerId,
          role: "PM",
          status: "ACTIVE",
          user: {
            id: ownerId,
            username: "pm",
            name: "PM User",
            status: "ACTIVE",
          },
        },
      ],
      total: 1,
    });
    listRequirementsMock.mockResolvedValue({ items: [], total: 0 });

    render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementVersionsMock).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.page.filter" }),
    );
    fireEvent.change(screen.getByTestId("requirements-filter-version"), {
      target: { value: versionId },
    });
    fireEvent.change(screen.getByTestId("requirements-filter-owner"), {
      target: { value: ownerId },
    });

    await waitFor(() =>
      expect(listRequirementsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerId,
          spaceId: "SPC_01",
          versionId,
        }),
      ),
    );
  });

  it("clears version and owner filters when the organization or space changes", async () => {
    const oldVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FD1";
    const oldOwnerId = "01ARZ3NDEKTSV4RRFFQ69G5FU1";
    const nextVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FD2";
    const nextOwnerId = "01ARZ3NDEKTSV4RRFFQ69G5FU2";

    listRequirementVersionsMock
      .mockResolvedValueOnce({
        items: [{ id: oldVersionId, name: "M1" }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [{ id: nextVersionId, name: "M2" }],
        total: 1,
      });
    listRequirementAssignableMembersMock
      .mockResolvedValueOnce({
        items: [
          {
            id: "MEMBER_01",
            organizationId: "ORG_01",
            spaceId: "SPC_01",
            userId: oldOwnerId,
            role: "PM",
            status: "ACTIVE",
            user: {
              id: oldOwnerId,
              username: "oldpm",
              name: "Old PM",
              status: "ACTIVE",
            },
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "MEMBER_02",
            organizationId: "ORG_02",
            spaceId: "SPC_02",
            userId: nextOwnerId,
            role: "PM",
            status: "ACTIVE",
            user: {
              id: nextOwnerId,
              username: "nextpm",
              name: "Next PM",
              status: "ACTIVE",
            },
          },
        ],
        total: 1,
      });
    listRequirementsMock.mockResolvedValue({ items: [], total: 0 });

    const { rerender } = render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementVersionsMock).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: "requirements.page.filter" }),
    );
    fireEvent.change(screen.getByTestId("requirements-filter-version"), {
      target: { value: oldVersionId },
    });
    fireEvent.change(screen.getByTestId("requirements-filter-owner"), {
      target: { value: oldOwnerId },
    });

    await waitFor(() =>
      expect(listRequirementsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerId: oldOwnerId,
          versionId: oldVersionId,
        }),
      ),
    );

    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_02",
        defaultSpaceId: "SPC_02",
        user: {
          id: "USER_01",
          name: "Requirement User",
          preferences: {
            locale: "zh-CN",
            themeMode: "SYSTEM",
          },
          status: "ACTIVE",
          username: "requirement",
        },
        spaces: [
          {
            id: "SPC_02",
            organizationId: "ORG_02",
            name: "Next Space",
            role: "PM",
            status: "ACTIVE",
          },
        ],
      },
      currentSpace: {
        id: "SPC_02",
        organizationId: "ORG_02",
        name: "Next Space",
        role: "PM",
        status: "ACTIVE",
      },
      status: "authenticated" as const,
    };
    rerender(<RequirementsPage />);

    await waitFor(() => {
      const lastCallIndex = listRequirementsMock.mock.calls.length - 1;
      const [query] = listRequirementsMock.mock.calls[lastCallIndex];
      expect(query).toMatchObject({
        organizationId: "ORG_02",
        spaceId: "SPC_02",
      });
      expect(query.ownerId).toBeUndefined();
      expect(query.versionId).toBeUndefined();
    });
  });

  it("creates a draft and navigates to its detail page when the user clicks 创建", async () => {
    listRequirementsMock.mockResolvedValueOnce({ items: [], total: 0 });
    createRequirementDraftMock.mockResolvedValueOnce(
      makeRequirement({ id: "01ARZ3NDEKTSV4RRFFQ69G5FNEW" }),
    );

    render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("requirements-create-button"));

    await waitFor(() =>
      expect(createRequirementDraftMock).toHaveBeenCalledWith(
        { organizationId: "ORG_01", spaceId: "SPC_01" },
        {},
      ),
    );
    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith(
        "/requirements/01ARZ3NDEKTSV4RRFFQ69G5FNEW",
      ),
    );
    const stored = JSON.parse(
      window.localStorage.getItem(
        createRecentStorageKey({
          organizationId: "ORG_01",
          spaceId: "SPC_01",
        }),
      ) ?? "[]",
    ) as Array<{ href: string; title: string; type: string }>;
    expect(stored[0]).toMatchObject({
      href: "/requirements/01ARZ3NDEKTSV4RRFFQ69G5FNEW",
      title: "Authentication refresh",
      type: "REQUIREMENT",
    });
  });

  it("does not create a draft from the button for VIEWER role", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space",
        role: "VIEWER",
        status: "ACTIVE",
      },
    };
    listRequirementsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalled());
    const createButton = screen.getByTestId("requirements-create-button");
    expect(createButton).toBeDisabled();

    fireEvent.click(createButton);

    expect(createRequirementDraftMock).not.toHaveBeenCalled();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("records directly opened requirements in recent opens", async () => {
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FRC",
          title: "Remember requirement",
          status: "CONFIRMED",
        }),
      ],
      total: 1,
    });

    render(<RequirementsPage />);

    fireEvent.click(await screen.findByText("Remember requirement"));

    const stored = JSON.parse(
      window.localStorage.getItem(
        createRecentStorageKey({
          organizationId: "ORG_01",
          spaceId: "SPC_01",
        }),
      ) ?? "[]",
    ) as Array<{ href: string; title: string; type: string }>;
    expect(stored[0]).toMatchObject({
      href: "/requirements/01ARZ3NDEKTSV4RRFFQ69G5FRC",
      title: "Remember requirement",
      type: "REQUIREMENT",
    });
  });

  it("renders the noSpace empty state when session has no defaultSpaceId", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: undefined as unknown as string,
        user: {
          id: "USER_01",
          name: "Requirement User",
          preferences: {
            locale: "zh-CN",
            themeMode: "SYSTEM",
          },
          status: "ACTIVE",
          username: "requirement",
        },
        spaces: [],
      },
      currentSpace:
        undefined as unknown as typeof sessionMock.current.currentSpace,
      status: "authenticated" as const,
    };

    render(<RequirementsPage />);

    expect(
      await screen.findByText("requirements.states.noSpace.title"),
    ).toBeInTheDocument();
    expect(listRequirementsMock).not.toHaveBeenCalled();
  });
});
