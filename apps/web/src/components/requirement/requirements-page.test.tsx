import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------------
// next-intl translator: stable per-namespace function, returns "ns.key".
// -----------------------------------------------------------------------------
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

const routerPushMock = vi.hoisted(() => vi.fn());
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
  usePathname: () => "/",
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { listRequirementsMock, createRequirementDraftMock } = vi.hoisted(() => ({
  listRequirementsMock: vi.fn(),
  createRequirementDraftMock: vi.fn(),
}));
vi.mock("../../lib/requirement-service", () => ({
  listRequirements: listRequirementsMock,
  createRequirementDraft: createRequirementDraftMock,
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
  routerPushMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    status: "authenticated" as const,
  };
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("RequirementsPage", () => {
  it("renders requirement rows with title and status badge", async () => {
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

    await waitFor(() =>
      expect(listRequirementsMock).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Onboarding redesign")).toBeInTheDocument();
    expect(screen.getByText("requirements.status.CONFIRMED")).toBeInTheDocument();
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
    let resolveList: (value: { items: unknown[]; total: number }) => void = () => {};
    listRequirementsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const { container } = render(<RequirementsPage />);

    await waitFor(() => expect(listRequirementsMock).toHaveBeenCalled());
    // ListSkeleton renders animate-pulse rows; the list itself is not yet present.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("requirements-list")).not.toBeInTheDocument();

    // Resolve so afterEach cleanup doesn't fight pending state.
    resolveList({ items: [], total: 0 });
    await waitFor(() =>
      expect(
        screen.getByText("requirements.states.empty.title"),
      ).toBeInTheDocument(),
    );
  });

  it("filters by ARCHIVED bucket when the user clicks it", async () => {
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F01",
          title: "Active draft",
          status: "DRAFT",
        }),
        makeRequirement({
          id: "01ARZ3NDEKTSV4RRFFQ69G5F02",
          title: "Old shipped",
          status: "ARCHIVED",
        }),
      ],
      total: 2,
    });

    render(<RequirementsPage />);

    expect(await screen.findByText("Active draft")).toBeInTheDocument();
    // Initial filter is "active" → ARCHIVED hidden.
    expect(screen.queryByText("Old shipped")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.filters.archived" }),
    );

    expect(screen.queryByText("Active draft")).not.toBeInTheDocument();
    expect(screen.getByText("Old shipped")).toBeInTheDocument();
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
        { spaceId: "SPC_01" },
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
      status: "authenticated" as const,
    };

    render(<RequirementsPage />);

    expect(
      await screen.findByText("requirements.states.noSpace.title"),
    ).toBeInTheDocument();
    expect(listRequirementsMock).not.toHaveBeenCalled();
  });
});
