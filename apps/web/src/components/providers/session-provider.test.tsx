import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPersistedAppSessionMock = vi.hoisted(() => vi.fn());
const setThemeMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const localeMock = vi.hoisted(() => ({
  current: "en-US",
}));
const pathnameMock = vi.hoisted(() => ({
  current: "/workbench",
}));

vi.mock("next-intl", () => ({
  useLocale: () => localeMock.current,
}));

vi.mock("../../i18n/routing", () => ({
  usePathname: () => pathnameMock.current,
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("../../lib/session-service", () => ({
  createOrganizationAndRefreshSession: vi.fn(),
  getPersistedAppSession: getPersistedAppSessionMock,
  loginAccount: vi.fn(),
  logoutAccount: vi.fn(),
  refreshAppSession: vi.fn(),
  registerAccount: vi.fn(),
  switchOrganization: vi.fn(),
  switchSpace: vi.fn(),
  updateUserPreferences: vi.fn(),
}));

vi.mock("./theme-provider", () => ({
  useTheme: () => ({ setTheme: setThemeMock }),
}));

import type { AppSession, ThemeMode } from "@project-delivery/shared";

import { SessionProvider, useSession } from "./session-provider";

function makeSession({
  locale = "zh-CN",
  themeMode = "DARK",
}: {
  locale?: string;
  themeMode?: ThemeMode;
} = {}): AppSession {
  return {
    capabilities: {
      canCreateOrganization: true,
      canCreateSpace: true,
    },
    defaultOrganizationId: "ORG_01",
    defaultSpaceId: "SPC_01",
    organizations: [
      {
        code: "ACME",
        id: "ORG_01",
        name: "Acme",
        role: "MEMBER",
        status: "ACTIVE",
      },
    ],
    spaces: [
      {
        code: "SPC",
        id: "SPC_01",
        name: "Space",
        organizationId: "ORG_01",
        role: "MEMBER",
        status: "ACTIVE",
      },
    ],
    user: {
      id: "USR_01",
      name: "Demo User",
      preferences: {
        locale,
        themeMode,
      },
      status: "ACTIVE",
      username: "demo",
    },
  } as AppSession;
}

function SessionProbe() {
  const { status } = useSession();

  return <div data-testid="session-status">{status}</div>;
}

beforeEach(() => {
  getPersistedAppSessionMock.mockReset();
  setThemeMock.mockReset();
  replaceMock.mockReset();
  localeMock.current = "en-US";
  pathnameMock.current = "/workbench";
  window.history.pushState(null, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("SessionProvider", () => {
  it("syncs theme from session preferences without replacing explicit URL locale", async () => {
    window.history.pushState(null, "", "/en-US/workbench");
    getPersistedAppSessionMock.mockResolvedValueOnce(
      makeSession({ locale: "zh-CN", themeMode: "DARK" }),
    );

    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session-status")).toHaveTextContent(
        "authenticated",
      ),
    );
    await waitFor(() => expect(setThemeMock).toHaveBeenCalledWith("dark"));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("restores the session locale preference when the URL has no explicit locale", async () => {
    localeMock.current = "zh-CN";
    window.history.pushState(null, "", "/workbench");
    getPersistedAppSessionMock.mockResolvedValueOnce(
      makeSession({ locale: "en-US", themeMode: "SYSTEM" }),
    );

    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session-status")).toHaveTextContent(
        "authenticated",
      ),
    );
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/workbench", {
        locale: "en-US",
      }),
    );
  });
});
