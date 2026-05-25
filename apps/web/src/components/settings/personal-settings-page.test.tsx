import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listAuthorizedMcpClientsMock = vi.hoisted(() => vi.fn());
const revokeAuthorizedMcpClientMock = vi.hoisted(() => vi.fn());
const getMcpProtectedResourceMetadataMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  value: {
    session: {
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        username: "ada",
      },
    },
    status: "authenticated",
  },
}));

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.value,
}));

vi.mock("../../lib/mcp-service", () => ({
  getMcpProtectedResourceMetadata: getMcpProtectedResourceMetadataMock,
  listAuthorizedMcpClients: listAuthorizedMcpClientsMock,
  revokeAuthorizedMcpClient: revokeAuthorizedMcpClientMock,
}));

import { PersonalSettingsPage } from "./personal-settings-page";

const clientId = "https://mcp-client.example.com/metadata.json";
const resourceUrl = "https://pdm.example.com/api/v1/mcp";

function createClient(overrides = {}) {
  return {
    authorizedAt: "2026-05-22T01:00:00.000Z",
    clientId,
    clientName: "Claude Desktop",
    clientUri: "https://mcp-client.example.com",
    lastUsedAt: "2026-05-22T02:00:00.000Z",
    scopes: ["mcp:read", "mcp:write:requirement"],
    status: "ACTIVE",
    ...overrides,
  };
}

function createMetadata(overrides = {}) {
  return {
    authorization_servers: ["https://pdm.example.com"],
    bearer_methods_supported: ["header"],
    resource: resourceUrl,
    resource_name: "PDM MCP",
    scopes_supported: ["mcp:read", "mcp:write:requirement"],
    ...overrides,
  };
}

beforeEach(() => {
  listAuthorizedMcpClientsMock.mockReset();
  revokeAuthorizedMcpClientMock.mockReset();
  getMcpProtectedResourceMetadataMock.mockReset();
  getMcpProtectedResourceMetadataMock.mockResolvedValue(createMetadata());
  sessionMock.value = {
    session: {
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        username: "ada",
      },
    },
    status: "authenticated",
  };
});

describe("PersonalSettingsPage", () => {
  it("renders MCP connection guidance from protected resource metadata", async () => {
    listAuthorizedMcpClientsMock.mockResolvedValueOnce([]);

    render(<PersonalSettingsPage />);

    expect(
      await screen.findByText("personalSettings.guide.title"),
    ).toBeInTheDocument();
    expect(await screen.findByText(resourceUrl)).toBeInTheDocument();
    expect(
      screen.queryByText(
        "https://pdm.example.com/.well-known/oauth-protected-resource",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("https://pdm.example.com"),
    ).not.toBeInTheDocument();
    expect(getMcpProtectedResourceMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("renders authorized MCP client details", async () => {
    listAuthorizedMcpClientsMock.mockResolvedValueOnce([createClient()]);

    render(<PersonalSettingsPage />);

    expect(await screen.findByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.getByText(clientId)).toBeInTheDocument();
    expect(screen.getByText("mcp-client.example.com")).toBeInTheDocument();
    expect(
      screen.getByText("personalSettings.status.ACTIVE"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("mcp.scopes.mcp:read").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText("mcp.scopes.mcp:write:requirement").length,
    ).toBeGreaterThan(0);
  });

  it("revokes a client and refreshes the list", async () => {
    listAuthorizedMcpClientsMock
      .mockResolvedValueOnce([createClient()])
      .mockResolvedValueOnce([createClient({ status: "REVOKED" })]);
    revokeAuthorizedMcpClientMock.mockResolvedValueOnce({});

    render(<PersonalSettingsPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /personalSettings.actions.revoke/u,
      }),
    );

    await waitFor(() => {
      expect(revokeAuthorizedMcpClientMock).toHaveBeenCalledWith(clientId);
    });
    await waitFor(() => {
      expect(listAuthorizedMcpClientsMock).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByText("personalSettings.status.REVOKED"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when no clients are authorized", async () => {
    listAuthorizedMcpClientsMock.mockResolvedValueOnce([]);

    render(<PersonalSettingsPage />);

    expect(
      await screen.findByText("personalSettings.states.empty.title"),
    ).toBeInTheDocument();
  });
});
