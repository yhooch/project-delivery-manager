import type {
  ListAuthorizedMcpClientsResponse,
  McpOAuthAuthorizeContext,
  McpProtectedResourceMetadata,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  McpOAuthAuthorizeError,
  approveMcpOAuthAuthorization,
  createMcpProtectedResourceMetadataUrl,
  createMcpOAuthAccessDeniedUrl,
  createMcpOAuthApproveAuthorizeUrl,
  createMcpOAuthAuthorizeUrl,
  getMcpProtectedResourceMetadata,
  getMcpOAuthAuthorizeContext,
  getMcpOAuthBasePath,
  listAuthorizedMcpClients,
  revokeAuthorizedMcpClient,
  type McpApiTransport,
} from "./mcp-service";

const clientId = "https://mcp-client.example.com/metadata.json";
const redirectUri = "https://mcp-client.example.com/oauth/callback";
const resource = "https://pdm.example.com/api/v1/mcp";
const authorizeQuery =
  "response_type=code&client_id=https%3A%2F%2Fmcp-client.example.com%2Fmetadata.json&redirect_uri=https%3A%2F%2Fmcp-client.example.com%2Foauth%2Fcallback&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&code_challenge_method=S256&scope=mcp%3Aread&state=state-1&resource=https%3A%2F%2Fpdm.example.com%2Fapi%2Fv1%2Fmcp";

function createApi(
  overrides: Partial<Record<keyof McpApiTransport, unknown>>,
): McpApiTransport {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as McpApiTransport;
}

function createAuthorizeContext(
  overrides: Partial<McpOAuthAuthorizeContext> = {},
): McpOAuthAuthorizeContext {
  return {
    client: {
      clientId,
      clientName: "Claude Desktop",
      clientUri: "https://mcp-client.example.com",
      createdAt: "2026-05-22T01:00:00.000Z",
      redirectUris: [redirectUri],
      registrationMode: "CLIENT_ID_METADATA_DOCUMENT",
      scopes: ["mcp:read"],
      status: "ACTIVE",
      updatedAt: "2026-05-22T01:00:00.000Z",
    },
    redirectHostname: "mcp-client.example.com",
    redirectIsLocalhost: false,
    redirectUri,
    resource,
    scopes: ["mcp:read"],
    state: "state-1",
    ...overrides,
  };
}

describe("mcp service", () => {
  it("lists authorized MCP clients through the wrapped API", async () => {
    const clients: ListAuthorizedMcpClientsResponse = [
      {
        authorizedAt: "2026-05-22T01:00:00.000Z",
        clientId,
        clientName: "Claude Desktop",
        clientUri: "https://mcp-client.example.com",
        lastUsedAt: "2026-05-22T02:00:00.000Z",
        scopes: ["mcp:read"],
        status: "ACTIVE",
      },
    ];
    const api = createApi({
      get: vi.fn(async () => ({ data: clients })),
    });

    await expect(listAuthorizedMcpClients(api)).resolves.toEqual(clients);

    expect(api.get).toHaveBeenCalledWith("/users/me/mcp/authorized-clients");
  });

  it("revokes an authorized MCP client through the current-user endpoint", async () => {
    const api = createApi({
      post: vi.fn(async () => ({ data: {} })),
    });

    await expect(revokeAuthorizedMcpClient(clientId, api)).resolves.toEqual({});

    expect(api.post).toHaveBeenCalledWith(
      "/users/me/mcp/authorized-clients/revoke",
      { clientId },
    );
  });

  it("builds OAuth authorize URLs from the API root", () => {
    expect(getMcpOAuthBasePath("https://api.example.com/api/v1")).toBe(
      "https://api.example.com",
    );
    expect(getMcpOAuthBasePath("/api/v1")).toBe("");
    expect(createMcpProtectedResourceMetadataUrl("")).toBe(
      "/.well-known/oauth-protected-resource",
    );
    expect(
      createMcpOAuthAuthorizeUrl("client_id=abc&scope=mcp%3Aread", ""),
    ).toBe("/oauth/authorize?client_id=abc&scope=mcp%3Aread");
    expect(
      createMcpOAuthAuthorizeUrl(
        new URLSearchParams("client_id=abc"),
        "https://api.example.com/api-root",
      ),
    ).toBe("https://api.example.com/api-root/oauth/authorize?client_id=abc");
  });

  it("builds OAuth approve URLs without query-driven consent", () => {
    expect(
      createMcpOAuthApproveAuthorizeUrl("client_id=abc&scope=mcp%3Aread", ""),
    ).toBe("/oauth/authorize/approve?client_id=abc&scope=mcp%3Aread");
  });

  it("loads protected resource metadata with JSON accept headers", async () => {
    const metadata: McpProtectedResourceMetadata = {
      authorization_servers: ["https://pdm.example.com"],
      bearer_methods_supported: ["header"],
      resource,
      resource_name: "PDM MCP",
      scopes_supported: ["mcp:read", "mcp:write:requirement"],
    };
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify(metadata), { status: 200 });
    });

    await expect(getMcpProtectedResourceMetadata(fetcher)).resolves.toEqual(
      metadata,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/.well-known/oauth-protected-resource",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        method: "GET",
      }),
    );
  });

  it("posts OAuth approval and returns the redirect URL", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          redirectTo:
            "https://mcp-client.example.com/oauth/callback?code=code-1",
        }),
        { status: 200 },
      );
    });

    await expect(
      approveMcpOAuthAuthorization("client_id=abc", fetcher),
    ).resolves.toBe(
      "https://mcp-client.example.com/oauth/callback?code=code-1",
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/oauth/authorize/approve?client_id=abc",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "POST",
      }),
    );
  });

  it("loads raw OAuth authorize context with JSON accept headers", async () => {
    const context = createAuthorizeContext();
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify(context), { status: 200 });
    });

    await expect(
      getMcpOAuthAuthorizeContext(authorizeQuery, fetcher),
    ).resolves.toEqual(context);

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/oauth/authorize?response_type=code"),
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      }),
    );
  });

  it("maps OAuth protocol errors from raw authorize responses", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: "invalid_scope",
          error_description: "Requested scope is not registered",
        }),
        { status: 400, statusText: "Bad Request" },
      );
    });

    await expect(
      getMcpOAuthAuthorizeContext(authorizeQuery, fetcher),
    ).rejects.toMatchObject({
      code: "invalid_scope",
      message: "Requested scope is not registered",
      status: 400,
    } satisfies Partial<McpOAuthAuthorizeError>);
  });

  it("builds access denied redirect URLs with state", () => {
    expect(createMcpOAuthAccessDeniedUrl(createAuthorizeContext())).toBe(
      "https://mcp-client.example.com/oauth/callback?error=access_denied&error_description=The+user+denied+the+authorization+request.&state=state-1",
    );
  });
});
