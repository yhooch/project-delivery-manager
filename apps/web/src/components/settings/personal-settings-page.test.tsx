import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listAuthorizedMcpClientsMock = vi.hoisted(() => vi.fn());
const revokeAuthorizedMcpClientMock = vi.hoisted(() => vi.fn());
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
  listAuthorizedMcpClients: listAuthorizedMcpClientsMock,
  revokeAuthorizedMcpClient: revokeAuthorizedMcpClientMock,
}));

import { PersonalSettingsPage } from "./personal-settings-page";

const clientId = "https://mcp-client.example.com/metadata.json";

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

beforeEach(() => {
  listAuthorizedMcpClientsMock.mockReset();
  revokeAuthorizedMcpClientMock.mockReset();
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
  it("renders authorized MCP client details", async () => {
    listAuthorizedMcpClientsMock.mockResolvedValueOnce([createClient()]);

    render(<PersonalSettingsPage />);

    expect(await screen.findByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.getByText(clientId)).toBeInTheDocument();
    expect(screen.getByText("mcp-client.example.com")).toBeInTheDocument();
    expect(screen.getByText("personalSettings.status.ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("mcp.scopes.mcp:read")).toBeInTheDocument();
    expect(
      screen.getByText("mcp.scopes.mcp:write:requirement"),
    ).toBeInTheDocument();
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
