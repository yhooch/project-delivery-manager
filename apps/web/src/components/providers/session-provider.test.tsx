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
const searchParamsMock = vi.hoisted(() => ({
  current: new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => localeMock.current,
}));

vi.mock("../../i18n/routing", () => ({
  usePathname: () => pathnameMock.current,
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
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

import { ApiClientError } from "../../lib/api-client";
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
  const { sessionErrorKey, status } = useSession();

  return (
    <>
      <div data-testid="session-status">{status}</div>
      {sessionErrorKey ? (
        <div data-testid="session-error-key">{sessionErrorKey}</div>
      ) : null}
    </>
  );
}

beforeEach(() => {
  getPersistedAppSessionMock.mockReset();
  setThemeMock.mockReset();
  replaceMock.mockReset();
  localeMock.current = "en-US";
  pathnameMock.current = "/workbench";
  searchParamsMock.current = new URLSearchParams();
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

  it("restores the session locale preference and preserves query when the URL has no explicit locale", async () => {
    localeMock.current = "zh-CN";
    pathnameMock.current = "/bugs";
    searchParamsMock.current = new URLSearchParams({
      bugId: "01ARZ3NDEKTSV4RRFFQ69G5FDL",
      panel: "timeline",
    });
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
      expect(replaceMock).toHaveBeenCalledWith(
        "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FDL&panel=timeline",
        {
          locale: "en-US",
        },
      ),
    );
  });

  it("treats an unauthorized persisted session as unauthenticated", async () => {
    getPersistedAppSessionMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "UNAUTHORIZED",
          message: "Unauthorized",
          requestId: "req_session_unauthorized",
        },
        new Response(null, { status: 401 }),
      ),
    );

    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session-status")).toHaveTextContent(
        "unauthenticated",
      ),
    );
    expect(screen.queryByTestId("session-error-key")).not.toBeInTheDocument();
  });

  it("exposes a recoverable error state when persisted session loading fails", async () => {
    getPersistedAppSessionMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "INTERNAL_SERVER_ERROR",
          message: "Session failed",
          requestId: "req_session_failed",
        },
        new Response(null, { status: 500 }),
      ),
    );

    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session-status")).toHaveTextContent("error"),
    );
    expect(screen.getByTestId("session-error-key")).toHaveTextContent(
      "errors.api.INTERNAL_SERVER_ERROR",
    );
  });
});
