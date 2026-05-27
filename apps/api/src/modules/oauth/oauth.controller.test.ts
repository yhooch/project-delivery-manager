import { HttpStatus } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type {
  McpOAuthAuthorizeContext,
  McpOAuthAuthorizeQuery,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { RequestWithContext } from "../../http/request-context";
import { OAuthController, OAuthDiscoveryController } from "./oauth.controller";
import { OAuthConfigService } from "./oauth-config.service";
import type { OAuthService } from "./oauth.service";

const clientId = "test-mcp-client";
const redirectUri = "http://localhost:4555/callback";
const resource = "http://localhost:3001/api/v1/mcp";
const userId = "01HX0000000000000000000000";

describe("OAuthController", () => {
  it("exposes the dynamic client registration endpoint in discovery metadata", () => {
    const { discovery, oauth } = createSubject();
    const response = new MockResponse();
    oauth.getAuthorizationServerMetadata.mockReturnValueOnce({
      issuer: "http://localhost:3001",
      authorization_endpoint: "http://localhost:3001/oauth/authorize",
      token_endpoint: "http://localhost:3001/oauth/token",
      revocation_endpoint: "http://localhost:3001/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:read"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      registration_endpoint: "http://localhost:3001/oauth/register",
    });

    discovery.getAuthorizationServerMetadata(
      request({ accept: "application/json" }),
      response,
    );

    expect(response.statusCode).toBe(HttpStatus.OK);
    expect(response.body).toMatchObject({
      registration_endpoint: "http://localhost:3001/oauth/register",
    });
  });

  it("registers a dynamic public client", async () => {
    const { controller, oauth } = createSubject();
    const response = new MockResponse();
    oauth.registerDynamicClient.mockResolvedValueOnce({
      client_id: "mcp_dcr_01HX0000000000000000000000",
      client_id_issued_at: 1_779_436_800,
      client_name: "Codex CLI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:read",
      token_endpoint_auth_method: "none",
    });

    await controller.register(
      {
        redirect_uris: [redirectUri],
        client_name: "Codex CLI",
      },
      response,
    );

    expect(oauth.registerDynamicClient).toHaveBeenCalledWith({
      redirect_uris: [redirectUri],
      client_name: "Codex CLI",
    });
    expect(response.statusCode).toBe(HttpStatus.CREATED);
    expect(response.body).toMatchObject({
      client_id: "mcp_dcr_01HX0000000000000000000000",
      token_endpoint_auth_method: "none",
    });
  });

  it("rejects dynamic client registration with an unsafe redirect URI", async () => {
    const { controller, oauth } = createSubject();
    const response = new MockResponse();

    await controller.register(
      {
        redirect_uris: ["http://agent.example.com/callback"],
      },
      response,
    );

    expect(oauth.registerDynamicClient).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toMatchObject({
      error: "invalid_client_metadata",
    });
  });

  it("rejects dynamic client registration with unsupported scopes", async () => {
    const { controller, oauth } = createSubject();
    const response = new MockResponse();

    await controller.register(
      {
        redirect_uris: [redirectUri],
        scope: "mcp:read files:read",
      },
      response,
    );

    expect(oauth.registerDynamicClient).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toMatchObject({
      error: "invalid_client_metadata",
    });
  });

  it("redirects unconfirmed HTML authorize requests to the web consent page", async () => {
    const { controller, oauth } = createSubject();
    const response = new MockResponse();

    await controller.authorize(
      authorizeQuery(),
      request({ accept: "text/html" }),
      response,
    );

    expect(response.redirectStatus).toBe(HttpStatus.FOUND);
    expect(response.redirectTo).toBe(
      "http://localhost:3001/zh-CN/oauth/mcp/authorize?response_type=code&client_id=test-mcp-client&redirect_uri=http%3A%2F%2Flocalhost%3A4555%2Fcallback&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&code_challenge_method=S256&scope=mcp%3Aread&resource=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fv1%2Fmcp&state=state-1",
    );
    expect(oauth.prepareAuthorization).not.toHaveBeenCalled();
  });

  it("returns authorize context for JSON requests without granting a code", async () => {
    const { controller, grant, oauth } = createSubject();
    const response = new MockResponse();

    await controller.authorize(
      authorizeQuery(),
      request({ accept: "application/json", withSession: true }),
      response,
    );

    expect(oauth.prepareAuthorization).toHaveBeenCalledWith(
      authorizeQuery(),
      userId,
      expect.objectContaining({
        headers: expect.objectContaining({ host: "localhost:3001" }),
      }),
    );
    expect(response.statusCode).toBe(HttpStatus.OK);
    expect(response.body).toEqual(authorizeContext());
    expect(grant).not.toHaveBeenCalled();
  });

  it("defaults omitted authorize resource to the canonical MCP resource", async () => {
    const { controller, oauth } = createSubject();
    const response = new MockResponse();

    await controller.authorize(
      authorizeQueryWithoutResource(),
      request({ accept: "application/json", withSession: true }),
      response,
    );

    expect(oauth.prepareAuthorization).toHaveBeenCalledWith(
      authorizeQuery(),
      userId,
      expect.objectContaining({
        headers: expect.objectContaining({ host: "localhost:3001" }),
      }),
    );
    expect(response.statusCode).toBe(HttpStatus.OK);
  });

  it("does not grant a code from an approval consent query parameter", async () => {
    const { controller, grant } = createSubject();
    const response = new MockResponse();

    await controller.authorize(
      {
        ...authorizeQuery(),
        consent: "approve",
      },
      request({ accept: "text/html", withSession: true }),
      response,
    );

    expect(grant).not.toHaveBeenCalled();
    expect(response.redirectStatus).toBe(HttpStatus.FOUND);
    expect(response.redirectTo).toBe(
      "http://localhost:3001/zh-CN/oauth/mcp/authorize?response_type=code&client_id=test-mcp-client&redirect_uri=http%3A%2F%2Flocalhost%3A4555%2Fcallback&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&code_challenge_method=S256&scope=mcp%3Aread&resource=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fv1%2Fmcp&state=state-1",
    );
  });

  it("grants a code through the approved authorize endpoint", async () => {
    const { controller, grant } = createSubject();
    const response = new MockResponse();

    await controller.approveAuthorization(
      authorizeQuery(),
      request({ accept: "application/json", withSession: true }),
      response,
    );

    expect(grant).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(HttpStatus.OK);
    expect(response.body).toEqual({
      redirectTo: "http://localhost:4555/callback?code=code-1&state=state-1",
    });
  });

  it("ignores approval consent for JSON authorize requests", async () => {
    const { controller, grant } = createSubject();
    const response = new MockResponse();

    await controller.authorize(
      {
        ...authorizeQuery(),
        consent: "approve",
      },
      request({ accept: "application/json", withSession: true }),
      response,
    );

    expect(response.statusCode).toBe(HttpStatus.OK);
    expect(response.body).toEqual(authorizeContext());
    expect(grant).not.toHaveBeenCalled();
  });

  it("defaults omitted token resource to the canonical MCP resource", async () => {
    const { controller, oauth } = createSubject();
    const response = new MockResponse();
    oauth.exchangeToken.mockResolvedValueOnce({
      access_token: "mcp_at_test",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "mcp_rt_test",
      scope: "mcp:read",
    });

    await controller.token(
      {
        grant_type: "authorization_code",
        client_id: clientId,
        code: "code-1",
        redirect_uri: redirectUri,
        code_verifier: "a".repeat(43),
      },
      request({ accept: "application/json" }),
      response,
    );

    expect(oauth.exchangeToken).toHaveBeenCalledWith(
      {
        grant_type: "authorization_code",
        client_id: clientId,
        code: "code-1",
        redirect_uri: redirectUri,
        code_verifier: "a".repeat(43),
        resource,
      },
      expect.objectContaining({
        headers: expect.objectContaining({ host: "localhost:3001" }),
      }),
    );
    expect(response.statusCode).toBe(HttpStatus.OK);
  });
});

function createSubject() {
  const grant = vi.fn(async () => ({
    code: "code-1",
    redirectTo: "http://localhost:4555/callback?code=code-1&state=state-1",
  }));
  const oauth = {
    getAuthorizationServerMetadata: vi.fn(),
    exchangeToken: vi.fn(),
    prepareAuthorization: vi.fn(async () => ({
      context: authorizeContext(),
      grant,
    })),
    registerDynamicClient: vi.fn(),
  };
  const config = {
    get: vi.fn(() => undefined),
  } as unknown as ConfigService;

  return {
    controller: new OAuthController(
      oauth as unknown as OAuthService,
      new OAuthConfigService(config),
    ),
    discovery: new OAuthDiscoveryController(oauth as unknown as OAuthService),
    grant,
    oauth,
  };
}

function request({
  accept,
  withSession = false,
}: {
  accept: string;
  withSession?: boolean;
}): RequestWithContext {
  return {
    headers: {
      accept,
      host: "localhost:3001",
    },
    protocol: "http",
    session: withSession
      ? {
          id: "session-id",
          userId,
          email: "user@example.com",
          name: "Test User",
          roles: [],
        }
      : undefined,
  } as RequestWithContext;
}

function authorizeQuery(): McpOAuthAuthorizeQuery {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    code_challenge_method: "S256",
    scope: "mcp:read",
    resource,
    state: "state-1",
  };
}

function authorizeQueryWithoutResource(): Omit<
  McpOAuthAuthorizeQuery,
  "resource"
> {
  const query: Partial<McpOAuthAuthorizeQuery> = { ...authorizeQuery() };
  delete query.resource;
  return query as Omit<McpOAuthAuthorizeQuery, "resource">;
}

function authorizeContext(): McpOAuthAuthorizeContext {
  return {
    client: {
      clientId,
      clientName: "Test MCP Client",
      createdAt: "2026-05-22T01:00:00.000Z",
      redirectUris: [redirectUri],
      registrationMode: "PRE_REGISTERED",
      scopes: ["mcp:read"],
      status: "ACTIVE",
      updatedAt: "2026-05-22T01:00:00.000Z",
    },
    redirectHostname: "localhost",
    redirectIsLocalhost: true,
    redirectUri,
    resource,
    scopes: ["mcp:read"],
    state: "state-1",
  };
}

class MockResponse {
  body: unknown;
  readonly headers = new Map<string, string>();
  redirectStatus = 0;
  redirectTo = "";
  statusCode = 0;

  json(body: unknown): void {
    this.body = body;
  }

  redirect(status: number, url: string): void {
    this.redirectStatus = status;
    this.redirectTo = url;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  status(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }
}
