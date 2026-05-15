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
  Link: ({ children }: { children: React.ReactNode }) => children,
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/",
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

const themeSetMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      user: {
        id: "USR_01",
        name: "User",
        preferences: { locale: "zh-CN", themeMode: "SYSTEM" },
      },
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Org A",
      role: "OWNER",
      status: "ACTIVE",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "MEMBER",
      status: "ACTIVE",
    } as
      | {
          id: string;
          organizationId: string;
          name: string;
          role: string;
          status: string;
        }
      | undefined,
    spacesForCurrentOrganization: [
      { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
      { id: "SPC_02", organizationId: "ORG_01", name: "Space B" },
    ],
    persistPreferences: vi.fn(),
    switchSpace: vi.fn(),
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

vi.mock("../providers/theme-provider", () => ({
  useTheme: () => ({ setTheme: themeSetMock }),
}));

const {
  listWorkItemsMock,
  listBugsMock,
  listRequirementsMock,
  listIntakeItemsMock,
} = vi.hoisted(() => ({
  listWorkItemsMock: vi.fn(),
  listBugsMock: vi.fn(),
  listRequirementsMock: vi.fn(),
  listIntakeItemsMock: vi.fn(),
}));
vi.mock("../../lib/work-item-service", () => ({
  listWorkItems: listWorkItemsMock,
}));
vi.mock("../../lib/bug-service", () => ({
  listBugs: listBugsMock,
}));
vi.mock("../../lib/requirement-service", () => ({
  listRequirements: listRequirementsMock,
}));
vi.mock("../../lib/intake-service", () => ({
  listIntakeItems: listIntakeItemsMock,
}));

import { CommandPalette, openCommandPalette } from "./command-palette";
import { createRecentStorageKey } from "./recent-opens";

const RECENT_KEY = createRecentStorageKey({
  organizationId: "ORG_01",
  spaceId: "SPC_01",
});

beforeEach(() => {
  listWorkItemsMock.mockReset();
  listBugsMock.mockReset();
  listRequirementsMock.mockReset();
  listIntakeItemsMock.mockReset();
  routerPushMock.mockReset();
  themeSetMock.mockReset();
  listWorkItemsMock.mockResolvedValue({
    items: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FT1",
        title: "Task A",
      },
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FT2",
        title: "Task B",
      },
    ],
    total: 2,
  });
  listBugsMock.mockResolvedValue({
    items: [{ id: "01ARZ3NDEKTSV4RRFFQ69G5FB1", title: "Bug Alpha" }],
    total: 1,
  });
  listRequirementsMock.mockResolvedValue({
    items: [
      { id: "01ARZ3NDEKTSV4RRFFQ69G5FR1", title: "Req One" },
      { id: "01ARZ3NDEKTSV4RRFFQ69G5FR2", title: "" },
    ],
    total: 2,
  });
  listIntakeItemsMock.mockResolvedValue({
    items: [{ id: "01ARZ3NDEKTSV4RRFFQ69G5FI1", title: "Intake one" }],
    total: 1,
  });
  sessionMock.current = {
    session: {
      user: {
        id: "USR_01",
        name: "User",
        preferences: { locale: "zh-CN", themeMode: "SYSTEM" },
      },
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Org A",
      role: "OWNER",
      status: "ACTIVE",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "MEMBER",
      status: "ACTIVE",
    },
    spacesForCurrentOrganization: [
      { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
      { id: "SPC_02", organizationId: "ORG_01", name: "Space B" },
    ],
    persistPreferences: vi.fn(),
    switchSpace: vi.fn(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

afterEach(() => {
  cleanup();
});

describe("CommandPalette", () => {
  it("renders navigation / switchSpace / create / preferences groups when open with empty query", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        ...sessionMock.current.currentSpace!,
        role: "SPACE_ADMIN",
      },
    };

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(screen.getByText("shell.command.switchSpace")).toBeInTheDocument();
    expect(screen.getByText("shell.command.create")).toBeInTheDocument();
    expect(screen.getByText("shell.command.createTask")).toBeInTheDocument();
    expect(screen.getByText("shell.command.createBug")).toBeInTheDocument();
    expect(
      screen.getByText("shell.command.createRequirement"),
    ).toBeInTheDocument();
    expect(screen.getByText("shell.command.preferences")).toBeInTheDocument();
    expect(screen.getByText("shell.command.nav.spaces")).toBeInTheDocument();
    expect(
      screen.getByText("shell.command.nav.spaceSettings"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("shell.command.nav.organization"),
    ).toBeInTheDocument();
    // Switch-space items render space names.
    expect(screen.getByText("Space A")).toBeInTheDocument();
    expect(screen.getByText("Space B")).toBeInTheDocument();
  });

  it("navigates to added default navigation destinations", async () => {
    render(<CommandPalette />);
    openCommandPalette();

    fireEvent.click(await screen.findByTestId("command-palette-nav-settings"));
    expect(routerPushMock).toHaveBeenCalledWith("/settings");

    openCommandPalette();
    fireEvent.click(
      await screen.findByTestId("command-palette-nav-organization"),
    );
    expect(routerPushMock).toHaveBeenCalledWith("/organization");
  });

  it("gates settings by current space but keeps organization visible for members", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentOrganization: {
        id: "ORG_01",
        name: "Org A",
        role: "MEMBER",
        status: "ACTIVE",
      },
      currentSpace: undefined,
      spacesForCurrentOrganization: [],
    };

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("command-palette-nav-spaces"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("command-palette-nav-settings"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("command-palette-nav-organization"),
    ).toBeInTheDocument();
  });

  it("hides create commands when there is no current space", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: undefined,
      spacesForCurrentOrganization: [],
      session: {
        ...sessionMock.current.session,
        defaultSpaceId: undefined as unknown as string,
      },
    };

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("command-palette-create-group"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("shell.command.createTask"),
    ).not.toBeInTheDocument();
  });

  it("hides create commands for VIEWER space role", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        ...sessionMock.current.currentSpace!,
        role: "VIEWER",
      },
    };

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("command-palette-create-group"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("shell.command.createBug"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("shell.command.createRequirement"),
    ).not.toBeInTheDocument();
  });

  it("shows bug creation only for tester writers", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        ...sessionMock.current.currentSpace!,
        role: "TESTER",
      },
    };

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("shell.command.createTask"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("shell.command.createBug")).toBeInTheDocument();
    expect(
      screen.queryByText("shell.command.createRequirement"),
    ).not.toBeInTheDocument();
  });

  it("shows requirement creation only for requirement writers", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        ...sessionMock.current.currentSpace!,
        role: "REQUIREMENT",
      },
    };

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("shell.command.createTask"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("shell.command.createBug"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("shell.command.createRequirement"),
    ).toBeInTheDocument();
  });

  it("prefetches fresh current-space results each time the palette opens", async () => {
    render(<CommandPalette />);
    openCommandPalette();

    await waitFor(() => expect(listWorkItemsMock).toHaveBeenCalledTimes(1));
    expect(listWorkItemsMock).toHaveBeenLastCalledWith({
      spaceId: "SPC_01",
      organizationId: "ORG_01",
      page: 1,
      pageSize: 100,
    });

    fireEvent.click(await screen.findByTestId("command-palette-nav-spaces"));
    openCommandPalette();

    await waitFor(() => expect(listWorkItemsMock).toHaveBeenCalledTimes(2));
    expect(listBugsMock).toHaveBeenCalledTimes(2);
    expect(listRequirementsMock).toHaveBeenCalledTimes(2);
    expect(listIntakeItemsMock).toHaveBeenCalledTimes(2);
  });

  it("does not show the switchSpace group when there are no spaces", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      spacesForCurrentOrganization: [],
    };

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("shell.command.switchSpace"),
    ).not.toBeInTheDocument();
  });

  it("loads recent entries from localStorage when the palette opens", async () => {
    // Use a task id that also exists in the listWorkItems mock so the recent
    // entry is not pruned by `pruneStaleRecent` after the fetch lands.
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FT1",
          type: "TASK",
          code: "TASK-AAA",
          title: "Recently visited task",
          href: "/work-items",
        },
      ]),
    );

    render(<CommandPalette />);
    openCommandPalette();

    // The recent item title must render once the palette opens AND the live
    // pruning step has reconciled with the fetched results.
    expect(
      await screen.findByText("Recently visited task"),
    ).toBeInTheDocument();
  });

  it("keeps direct-open recent entries when the prefetched page is incomplete", async () => {
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FT1",
          title: "Task A",
        },
      ],
      total: 100,
    });
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FZZ",
          type: "TASK",
          code: "TASK-MISS",
          title: "Directly opened old task",
          href: "/work-items",
        },
      ]),
    );

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("Directly opened old task"),
    ).toBeInTheDocument();
    await waitFor(() => expect(listWorkItemsMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Directly opened old task")).toBeInTheDocument();
  });

  it("does not leak recent entries across organization or space scopes", async () => {
    window.localStorage.setItem(
      createRecentStorageKey({
        organizationId: "ORG_OLD",
        spaceId: "SPC_OLD",
      }),
      JSON.stringify([
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FT1",
          type: "TASK",
          code: "TASK-OLD",
          title: "Previous organization task",
          href: "/work-items",
        },
      ]),
    );

    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Previous organization task"),
    ).not.toBeInTheDocument();
  });

  it("ignores malformed recent entries from localStorage", async () => {
    window.localStorage.setItem(RECENT_KEY, "not-json-at-all");

    render(<CommandPalette />);
    openCommandPalette();

    await waitFor(() =>
      expect(screen.getByText("shell.command.navigation")).toBeInTheDocument(),
    );
    expect(screen.queryByText("shell.command.recent")).not.toBeInTheDocument();
  });

  it("caps recent history when writing (≤ helper RECENT_MAX)", async () => {
    // Pre-populate with more than the cap so we exercise the slice. The cap
    // is owned by the recent-opens helper; we just assert that the persisted
    // list stays bounded after a click and that the new entry sits at index 0.
    const existing = Array.from({ length: 12 }).map((_, idx) => ({
      id: `01ARZ3NDEKTSV4RRFFQ69G5F${(idx + 10).toString().padStart(2, "0")}`,
      type: "TASK" as const,
      code: `TASK-${idx}`,
      title: `Task ${idx}`,
      href: "/work-items",
    }));
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(existing));

    render(<CommandPalette />);
    openCommandPalette();

    const input = await screen.findByPlaceholderText(
      "shell.command.placeholder",
    );
    fireEvent.change(input, { target: { value: "Task A" } });

    const resultItem = await screen.findByText("Task A");
    fireEvent.click(resultItem);

    const storedRaw = window.localStorage.getItem(RECENT_KEY);
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw as string) as unknown[];
    // Helper caps at <=12; the newest entry should always be at index 0.
    expect(stored.length).toBeLessThanOrEqual(12);
    expect((stored[0] as { title: string }).title).toBe("Task A");
    expect((stored[0] as { href: string }).href).toBe(
      "/work-items?workItemId=01ARZ3NDEKTSV4RRFFQ69G5FT1",
    );
  });

  it("shows the search view with grouped results when query has ≥2 chars", async () => {
    render(<CommandPalette />);
    openCommandPalette();

    const input = await screen.findByPlaceholderText(
      "shell.command.placeholder",
    );
    fireEvent.change(input, { target: { value: "tas" } });

    // Search view groups by category — heading keys appear when their group
    // has at least one item.
    await waitFor(() => {
      expect(
        screen.getByText("shell.command.results.tasks"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Task A")).toBeInTheDocument();
    // Navigation group should NOT be visible while in search view.
    expect(
      screen.queryByText("shell.command.navigation"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the untitled label when a requirement has no title", async () => {
    render(<CommandPalette />);
    openCommandPalette();

    const input = await screen.findByPlaceholderText(
      "shell.command.placeholder",
    );
    fireEvent.change(input, { target: { value: "REQ" } });

    await waitFor(() => {
      expect(
        screen.getByText("shell.command.results.requirements"),
      ).toBeInTheDocument();
    });
    // At least one requirement uses the untitled fallback string.
    expect(screen.getByText("shell.command.untitled")).toBeInTheDocument();
  });

  it("opens bug search results through a direct detail href", async () => {
    render(<CommandPalette />);
    openCommandPalette();

    const input = await screen.findByPlaceholderText(
      "shell.command.placeholder",
    );
    fireEvent.change(input, { target: { value: "Bug" } });

    fireEvent.click(await screen.findByText("Bug Alpha"));

    expect(routerPushMock).toHaveBeenCalledWith(
      "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FB1",
    );
  });

  it("persists theme preference when selecting a theme command", async () => {
    render(<CommandPalette />);
    openCommandPalette();

    fireEvent.click(await screen.findByText("shell.command.themeDark"));

    expect(themeSetMock).toHaveBeenCalledWith("dark");
    expect(sessionMock.current.persistPreferences).toHaveBeenCalledWith({
      themeMode: "DARK",
    });
  });
});
