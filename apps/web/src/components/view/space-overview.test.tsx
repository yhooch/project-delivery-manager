import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
  } as { session: unknown; currentSpace: unknown },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { getSpaceOverviewViewMock } = vi.hoisted(() => ({
  getSpaceOverviewViewMock: vi.fn(),
}));
vi.mock("../../lib/view-service", () => ({
  getSpaceOverviewView: getSpaceOverviewViewMock,
}));

import { SpaceOverview } from "./space-overview";

function makeOverview(overrides: Record<string, unknown> = {}) {
  return {
    stats: {
      requirementCount: 12,
      taskCount: 20,
      completedTaskCount: 5,
      bugCount: 8,
      openBugCount: 3,
      blockedCount: 2,
      overdueCount: 4,
    },
    currentVersion: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
      name: "v1.0.0",
      target: "Public beta launch",
      targetDate: "2026-06-01T00:00:00.000Z",
    },
    exceptionCounts: [
      { exceptionType: "overdue", count: 4 },
      { exceptionType: "blocked", count: 2 },
    ],
    recentActivities: {
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
          actor: { name: "Charlie", username: "charlie", id: "U1" },
          target: { type: "WORK_ITEM", id: "W1", title: "TASK-ABC123" },
          eventType: "WORK_ITEM_UPDATED",
          title: "edited",
          createdAt: "2026-05-13T22:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  getSpaceOverviewViewMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
  };
});

afterEach(() => {
  cleanup();
});

describe("SpaceOverview", () => {
  it("renders KPI cards, version block, recent activity and exception counts", async () => {
    getSpaceOverviewViewMock.mockResolvedValueOnce(makeOverview());

    render(<SpaceOverview />);

    await waitFor(() =>
      expect(getSpaceOverviewViewMock).toHaveBeenCalledTimes(1),
    );

    // Active version card.
    expect(await screen.findByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Public beta launch")).toBeInTheDocument();

    // KPI cards: requirementCount = 12, task = 5/20, bug = 3/8, exceptions = 6.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5/20")).toBeInTheDocument();
    expect(screen.getByText("3/8")).toBeInTheDocument();
    // total exceptions = 4 + 2 = 6.
    expect(screen.getByText("6")).toBeInTheDocument();

    // Exception type rows render with translation keys.
    expect(
      screen.getByText("m4Views.exceptionType.overdue"),
    ).toBeInTheDocument();

    // Recent activity actor name shows up.
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders the empty messages when exceptionCounts and recentActivities are empty", async () => {
    getSpaceOverviewViewMock.mockResolvedValueOnce(
      makeOverview({
        exceptionCounts: [],
        recentActivities: { items: [] },
        stats: {
          requirementCount: 0,
          taskCount: 0,
          completedTaskCount: 0,
          bugCount: 0,
          openBugCount: 0,
          blockedCount: 0,
          overdueCount: 0,
        },
      }),
    );

    render(<SpaceOverview />);

    await waitFor(() =>
      expect(getSpaceOverviewViewMock).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText("spaceOverview.exceptions.empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("spaceOverview.timeline.empty"),
    ).toBeInTheDocument();
  });

  it("renders the error state when the view fetch rejects", async () => {
    getSpaceOverviewViewMock.mockRejectedValueOnce(new Error("network"));

    render(<SpaceOverview />);

    expect(
      await screen.findByText("spaceOverview.errorTitle"),
    ).toBeInTheDocument();
  });

  it("shows the loading state while the view fetch is pending", async () => {
    let resolve: (value: ReturnType<typeof makeOverview>) => void = () => {};
    getSpaceOverviewViewMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    render(<SpaceOverview />);

    expect(
      await screen.findByText("spaceOverview.states.loading.title"),
    ).toBeInTheDocument();

    resolve(makeOverview({ exceptionCounts: [], recentActivities: { items: [] } }));
    await waitFor(() =>
      expect(
        screen.getByText("spaceOverview.exceptions.empty"),
      ).toBeInTheDocument(),
    );
  });

  it("renders the unauthenticated empty state when session is null", async () => {
    sessionMock.current = {
      session: null,
      currentSpace: undefined,
    };

    render(<SpaceOverview />);

    expect(
      await screen.findByText("spaceOverview.states.unauthenticated.title"),
    ).toBeInTheDocument();
    expect(getSpaceOverviewViewMock).not.toHaveBeenCalled();
  });

  it("renders the noSpace empty state when session has no defaultSpaceId", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: undefined,
      },
      currentSpace: undefined,
    };

    render(<SpaceOverview />);

    expect(
      await screen.findByText("spaceOverview.noSpace.title"),
    ).toBeInTheDocument();
    expect(getSpaceOverviewViewMock).not.toHaveBeenCalled();
  });
});
