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
    render(<CommandPalette />);
    openCommandPalette();

    expect(
      await screen.findByText("shell.command.navigation"),
    ).toBeInTheDocument();
    expect(screen.getByText("shell.command.switchSpace")).toBeInTheDocument();
    expect(screen.getByText("shell.command.create")).toBeInTheDocument();
    expect(screen.getByText("shell.command.preferences")).toBeInTheDocument();
    // Switch-space items render space names.
    expect(screen.getByText("Space A")).toBeInTheDocument();
    expect(screen.getByText("Space B")).toBeInTheDocument();
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
      expect(screen.getByText("shell.command.results.tasks")).toBeInTheDocument();
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
