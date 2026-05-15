import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
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
    expect(await screen.findByText("PM User (pm)")).toBeInTheDocument();
    // The list renders with the testid.
    expect(screen.getByTestId("requirements-list")).toBeInTheDocument();
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
      screen.getByRole("button", { name: "requirements.filters.archived" }),
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
      screen.getByRole("button", { name: "requirements.filters.all" }),
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
    fireEvent.change(screen.getByLabelText("requirements.filters.version"), {
      target: { value: versionId },
    });
    fireEvent.change(screen.getByLabelText("requirements.filters.owner"), {
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
