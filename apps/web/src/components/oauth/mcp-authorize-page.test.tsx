import { fireEvent, render, screen } from "@testing-library/react";
import type { McpOAuthAuthorizeContext } from "@project-delivery/shared";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMcpOAuthApproveAuthorizeUrlMock = vi.hoisted(() => vi.fn());
const getMcpOAuthAuthorizeContextMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  value: {
    status: "authenticated",
  },
}));
const authorizeQuery =
  "client_id=https%3A%2F%2Fmcp-client.example.com%2Fmetadata.json&scope=mcp%3Aread";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) =>
    (key: string, values?: Record<string, string>) => {
      const base = namespace ? `${namespace}.${key}` : key;
      return values?.clientName ? `${base}:${values.clientName}` : base;
    },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(authorizeQuery),
}));

vi.mock("../../i18n/routing", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.value,
}));

vi.mock("../../lib/mcp-service", async () => {
  const actual = await vi.importActual<typeof import("../../lib/mcp-service")>(
    "../../lib/mcp-service",
  );

  return {
    ...actual,
    createMcpOAuthApproveAuthorizeUrl: createMcpOAuthApproveAuthorizeUrlMock,
    getMcpOAuthAuthorizeContext: getMcpOAuthAuthorizeContextMock,
  };
});

import { McpAuthorizePage } from "./mcp-authorize-page";

function createContext(
  overrides: Partial<McpOAuthAuthorizeContext> = {},
): McpOAuthAuthorizeContext {
  return {
    client: {
      clientId: "https://mcp-client.example.com/metadata.json",
      clientName: "Claude Desktop",
      clientUri: "https://mcp-client.example.com",
      createdAt: "2026-05-22T01:00:00.000Z",
      metadataDocumentUri: "https://mcp-client.example.com/metadata.json",
      redirectUris: ["http://localhost:4321/callback"],
      registrationMode: "CLIENT_ID_METADATA_DOCUMENT",
      scopes: ["mcp:read", "mcp:write:requirement"],
      status: "ACTIVE",
      updatedAt: "2026-05-22T01:00:00.000Z",
    },
    redirectHostname: "localhost",
    redirectIsLocalhost: true,
    redirectUri: "http://localhost:4321/callback",
    resource: "https://crm.example.com/api/v1/mcp",
    scopes: ["mcp:read", "mcp:write:requirement"],
    state: "state-1",
    ...overrides,
  };
}

beforeEach(() => {
  createMcpOAuthApproveAuthorizeUrlMock.mockReset();
  createMcpOAuthApproveAuthorizeUrlMock.mockReturnValue("#approved");
  getMcpOAuthAuthorizeContextMock.mockReset();
  sessionMock.value = {
    status: "authenticated",
  };
  window.history.replaceState(null, "", "/oauth/mcp/authorize");
});

describe("McpAuthorizePage", () => {
  it("renders OAuth authorize context and localhost risk", async () => {
    getMcpOAuthAuthorizeContextMock.mockResolvedValueOnce(createContext());

    render(<McpAuthorizePage />);

    expect(await screen.findByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.getByText("localhost")).toBeInTheDocument();
    expect(screen.getByText("mcp.scopes.mcp:read")).toBeInTheDocument();
    expect(
      screen.getByText("mcp.scopes.mcp:write:requirement"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("oauth.mcpAuthorize.risk.localhostTitle"),
    ).toBeInTheDocument();
    expect(getMcpOAuthAuthorizeContextMock).toHaveBeenCalledWith(authorizeQuery);
  });

  it("routes confirmation through an approved authorize URL", async () => {
    getMcpOAuthAuthorizeContextMock.mockResolvedValueOnce(createContext());

    render(<McpAuthorizePage />);

    const confirm = await screen.findByRole("button", {
      name: "oauth.mcpAuthorize.actions.confirm",
    });

    fireEvent.click(confirm);

    expect(createMcpOAuthApproveAuthorizeUrlMock).toHaveBeenCalledWith(
      authorizeQuery,
    );
    expect(window.location.hash).toBe("#approved");
  });

  it("shows a sign-in entry when the user is not authenticated", () => {
    sessionMock.value = {
      status: "unauthenticated",
    };

    render(<McpAuthorizePage />);

    expect(
      screen.getByText("oauth.mcpAuthorize.states.unauthenticated.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "oauth.mcpAuthorize.actions.signIn" }),
    ).toHaveAttribute("href", "/login");
    expect(getMcpOAuthAuthorizeContextMock).not.toHaveBeenCalled();
  });
});
