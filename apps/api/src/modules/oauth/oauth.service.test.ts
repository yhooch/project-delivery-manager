import { createHash } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import type {
  AuthorizedMcpClient,
  McpOAuthAuthorizeQuery,
  McpOAuthTokenRequest,
  McpScope,
} from "@project-delivery/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";

import { McpBearerAuthenticationError } from "./mcp-bearer-auth.error";
import { OAuthClientMetadataService } from "./oauth-client-metadata.service";
import { OAuthConfigService } from "./oauth-config.service";
import { OAuthProtocolError } from "./oauth-protocol.error";
import { OAuthService } from "./oauth.service";
import { OAuthTokenService } from "./oauth-token.service";
import type {
  CreateAuthorizationCodeInput,
  CreateOAuthClientInput,
  CreateTokenPairInput,
  McpOAuthRepository,
  RotateRefreshTokenInput,
  StoredMcpOAuthAccessToken,
  StoredMcpOAuthAuthorization,
  StoredMcpOAuthAuthorizationCode,
  StoredMcpOAuthClient,
  StoredMcpOAuthRefreshToken,
} from "./oauth.types";

const CLIENT_ID = "test-mcp-client";
const REDIRECT_URI = "http://localhost:4555/callback";
const RESOURCE = "http://localhost:3001/api/v1/mcp";
const USER_ID = "01HX0000000000000000000000";
const VERIFIER = "a".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

describe("OAuthService", () => {
  let repository: InMemoryOAuthRepository;
  let service: OAuthService;

  beforeEach(() => {
    repository = new InMemoryOAuthRepository();
    const config = new Map<string, unknown>([
      ["API_PUBLIC_URL", "http://localhost:3001"],
      ["MCP_CANONICAL_RESOURCE_URI", RESOURCE],
      ["MCP_OAUTH_ISSUER", "http://localhost:3001"],
      ["MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS", 3600],
      ["MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS", 2592000],
      ["MCP_OAUTH_AUTHORIZATION_CODE_TTL_SECONDS", 300],
      ["MCP_CLIENT_METADATA_CACHE_SECONDS", 3600],
      [
        "MCP_OAUTH_PRE_REGISTERED_CLIENTS",
        JSON.stringify([
          {
            clientId: CLIENT_ID,
            clientName: "Test MCP Client",
            redirectUris: [
              REDIRECT_URI,
              "http://localhost:4555/alternate-callback",
            ],
            scopes: ["mcp:read", "mcp:write:requirement"],
          },
        ]),
      ],
    ]);
    const configService = {
      get: (key: string) => config.get(key),
    } as ConfigService;
    const oauthConfig = new OAuthConfigService(configService);
    const metadata = new OAuthClientMetadataService(oauthConfig);

    service = new OAuthService(
      repository,
      new OAuthTokenService(),
      oauthConfig,
      metadata,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes dynamic client registration in authorization server metadata", () => {
    expect(service.getAuthorizationServerMetadata()).toMatchObject({
      registration_endpoint: "http://localhost:3001/oauth/register",
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("registers dynamic public clients with all supported scopes by default", async () => {
    const response = await service.registerDynamicClient({
      redirect_uris: ["http://localhost:4555/codex/callback"],
      client_name: "Codex CLI",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    const stored = repository.clients.get(response.client_id);

    expect(response).toMatchObject({
      client_name: "Codex CLI",
      redirect_uris: ["http://localhost:4555/codex/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: [
        "mcp:read",
        "mcp:write:requirement",
        "mcp:write:intake",
        "mcp:write:workitem",
        "mcp:write:bug",
        "mcp:write:comment",
        "mcp:write:document",
        "mcp:write:tag",
        "mcp:execute:workflow",
      ].join(" "),
      token_endpoint_auth_method: "none",
    });
    expect(response.client_id).toMatch(/^mcp_dcr_/u);
    expect(response.client_id_issued_at).toBeGreaterThan(0);
    expect(stored).toMatchObject({
      clientId: response.client_id,
      clientName: "Codex CLI",
      redirectUris: ["http://localhost:4555/codex/callback"],
      registrationMode: "DYNAMIC_CLIENT_REGISTRATION",
      scopes: [
        "mcp:read",
        "mcp:write:requirement",
        "mcp:write:intake",
        "mcp:write:workitem",
        "mcp:write:bug",
        "mcp:write:comment",
        "mcp:write:document",
        "mcp:write:tag",
        "mcp:execute:workflow",
      ],
      status: "ACTIVE",
    });
  });

  it("uses dynamically registered clients in the existing authorize and token flow", async () => {
    const registration = await service.registerDynamicClient({
      redirect_uris: [REDIRECT_URI],
      client_name: "Codex CLI",
      scope: "mcp:read mcp:write:requirement",
    });
    const prepared = await service.prepareAuthorization(
      {
        ...authorizeQuery("mcp:write:requirement"),
        client_id: registration.client_id,
      },
      USER_ID,
    );
    const grant = await prepared.grant();
    const code = new URL(grant.redirectTo).searchParams.get("code") ?? "";
    const tokenResponse = await service.exchangeToken({
      grant_type: "authorization_code",
      client_id: registration.client_id,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
      resource: RESOURCE,
    });

    expect(prepared.context.client.registrationMode).toBe(
      "DYNAMIC_CLIENT_REGISTRATION",
    );
    expect(tokenResponse.scope).toBe("mcp:write:requirement");
  });

  it("exchanges authorization code with PKCE and stores token hashes only", async () => {
    const prepared = await service.prepareAuthorization(
      authorizeQuery("mcp:read"),
      USER_ID,
    );

    expect(prepared.context.redirectHostname).toBe("localhost");
    expect(prepared.context.redirectIsLocalhost).toBe(true);

    const grant = await prepared.grant();
    const code = new URL(grant.redirectTo).searchParams.get("code");

    expect(code).toBeTruthy();

    const tokenResponse = await service.exchangeToken({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: code ?? "",
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
      resource: RESOURCE,
    });

    expect(tokenResponse.access_token).toMatch(/^mcp_at_/u);
    expect(tokenResponse.refresh_token).toMatch(/^mcp_rt_/u);
    expect(tokenResponse.scope).toBe("mcp:read");
    expect(repository.accessTokens[0]?.tokenHash).not.toBe(
      tokenResponse.access_token,
    );
    expect(repository.refreshTokens[0]?.tokenHash).not.toBe(
      tokenResponse.refresh_token,
    );
  });

  it("allows loopback redirect URIs to use a dynamic request port", async () => {
    const clientId = "loopback-client";
    const redirectUri = "http://localhost:42866/callback";

    await repository.upsertClient({
      id: ulid(),
      clientId,
      clientName: "Loopback Client",
      redirectUris: ["http://localhost/callback"],
      scopes: ["mcp:read"],
      status: "ACTIVE",
      registrationMode: "CLIENT_ID_METADATA_DOCUMENT",
      metadataDocumentUri: "https://client.example.com/metadata.json",
      metadataDocumentFetchedAt: new Date(),
      metadataDocumentExpiresAt: new Date(Date.now() + 60_000),
    });

    const prepared = await service.prepareAuthorization(
      {
        ...authorizeQuery("mcp:read"),
        client_id: clientId,
        redirect_uri: redirectUri,
      },
      USER_ID,
    );
    const grant = await prepared.grant();
    const code = new URL(grant.redirectTo).searchParams.get("code") ?? "";

    await expect(
      service.exchangeToken({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: VERIFIER,
        resource: RESOURCE,
      }),
    ).resolves.toMatchObject({
      scope: "mcp:read",
      token_type: "Bearer",
    });
  });

  it("does not allow loopback redirect port changes when a port is registered", async () => {
    const clientId = "fixed-port-client";

    await repository.upsertClient({
      id: ulid(),
      clientId,
      clientName: "Fixed Port Client",
      redirectUris: ["http://localhost:4555/callback"],
      scopes: ["mcp:read"],
      status: "ACTIVE",
      registrationMode: "CLIENT_ID_METADATA_DOCUMENT",
      metadataDocumentUri: "https://client.example.com/metadata.json",
      metadataDocumentFetchedAt: new Date(),
      metadataDocumentExpiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.prepareAuthorization(
        {
          ...authorizeQuery("mcp:read"),
          client_id: clientId,
          redirect_uri: "http://localhost:42866/callback",
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({
      error: "invalid_request",
      message: "redirect_uri does not exactly match the client registration",
    });
  });

  it("refreshes metadata clients when cached scopes are stale", async () => {
    const clientId = "https://8.8.8.8/oauth-client.json";

    await repository.upsertClient({
      id: ulid(),
      clientId,
      clientName: "Stale Metadata Client",
      redirectUris: ["http://localhost/callback"],
      scopes: ["mcp:read"],
      status: "ACTIVE",
      registrationMode: "CLIENT_ID_METADATA_DOCUMENT",
      metadataDocumentUri: clientId,
      metadataDocumentFetchedAt: new Date(),
      metadataDocumentExpiresAt: new Date(Date.now() + 60_000),
    });

    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          client_id: clientId,
          client_name: "Refreshed Metadata Client",
          redirect_uris: ["http://localhost/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(
      service.prepareAuthorization(
        {
          ...authorizeQuery("mcp:read mcp:write:requirement"),
          client_id: clientId,
          redirect_uri: "http://localhost:42866/callback",
        },
        USER_ID,
      ),
    ).resolves.toMatchObject({
      context: {
        client: {
          clientName: "Refreshed Metadata Client",
          scopes: [
            "mcp:read",
            "mcp:write:requirement",
            "mcp:write:intake",
            "mcp:write:workitem",
            "mcp:write:bug",
            "mcp:write:comment",
            "mcp:write:document",
            "mcp:write:tag",
            "mcp:execute:workflow",
          ],
        },
      },
    });
    expect(fetcher).toHaveBeenCalledWith(new URL(clientId), {
      headers: {
        Accept: "application/json",
      },
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects authorization requests for a non-canonical resource", async () => {
    await expect(
      service.prepareAuthorization(
        {
          ...authorizeQuery("mcp:read"),
          resource: "http://localhost:3001/api/v1/other-mcp",
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({
      error: "invalid_request",
      message: "OAuth resource does not match this MCP server",
    });
  });

  it("rejects authorization code exchange when redirect_uri differs from the code request", async () => {
    const prepared = await service.prepareAuthorization(
      authorizeQuery("mcp:read"),
      USER_ID,
    );
    const grant = await prepared.grant();
    const code = new URL(grant.redirectTo).searchParams.get("code") ?? "";

    await expect(
      service.exchangeToken({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        redirect_uri: "http://localhost:4555/alternate-callback",
        code_verifier: VERIFIER,
        resource: RESOURCE,
      }),
    ).rejects.toMatchObject({
      error: "invalid_grant",
      message: "Authorization code is invalid",
    });
    expect(repository.accessTokens).toHaveLength(0);
    expect(repository.refreshTokens).toHaveLength(0);
  });

  it("rotates refresh tokens and rejects the previous refresh token", async () => {
    const initial = await issueToken("mcp:read");
    const rotated = await refresh(initial.refresh_token ?? "");

    expect(rotated.refresh_token).not.toBe(initial.refresh_token);

    await expect(refresh(initial.refresh_token ?? "")).rejects.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("revokes only the current user's authorization and invalidates refresh tokens", async () => {
    const initial = await issueToken("mcp:read");

    await service.revokeAuthorizedClient(USER_ID, CLIENT_ID);

    await expect(refresh(initial.refresh_token ?? "")).rejects.toMatchObject({
      error: "invalid_grant",
    });
    expect(await service.listAuthorizedClients(USER_ID)).toMatchObject([
      {
        clientId: CLIENT_ID,
        status: "REVOKED",
      },
    ]);
  });

  it("validates bearer token resource and required scopes", async () => {
    const initial = await issueToken("mcp:read");
    const principal = await service.validateBearerToken(
      `Bearer ${initial.access_token}`,
      ["mcp:read"],
    );

    expect(principal).toMatchObject({
      clientId: CLIENT_ID,
      resource: RESOURCE,
      userId: USER_ID,
    });

    await expect(
      service.validateBearerToken(`Bearer ${initial.access_token}`, [
        "mcp:write:requirement",
      ]),
    ).rejects.toBeInstanceOf(McpBearerAuthenticationError);
  });

  it("rejects bearer tokens whose stored resource audience is not canonical", async () => {
    const initial = await issueToken("mcp:read");
    const storedToken = repository.accessTokens[0];

    if (!storedToken) {
      throw new Error("Expected test access token to be stored.");
    }

    storedToken.resource = "http://localhost:3001/api/v1/other-mcp";

    await expect(
      service.validateBearerToken(`Bearer ${initial.access_token}`, [
        "mcp:read",
      ]),
    ).rejects.toMatchObject({
      challengeError: "invalid_token",
      status: 401,
      message: "Bearer token is invalid or expired",
    });
  });

  async function issueToken(scope: string) {
    const prepared = await service.prepareAuthorization(
      authorizeQuery(scope),
      USER_ID,
    );
    const grant = await prepared.grant();
    const code = new URL(grant.redirectTo).searchParams.get("code") ?? "";

    return service.exchangeToken({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
      resource: RESOURCE,
    });
  }

  async function refresh(refreshToken: string) {
    const request: McpOAuthTokenRequest = {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
      resource: RESOURCE,
    };

    return service.exchangeToken(request);
  }
});

function authorizeQuery(scope: string): McpOAuthAuthorizeQuery {
  return {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    scope,
    state: "state-123",
    resource: RESOURCE,
  };
}

class InMemoryOAuthRepository implements McpOAuthRepository {
  readonly accessTokens: StoredMcpOAuthAccessToken[] = [];
  readonly authorizations: StoredMcpOAuthAuthorization[] = [];
  readonly clients = new Map<string, StoredMcpOAuthClient>();
  readonly codes: StoredMcpOAuthAuthorizationCode[] = [];
  readonly refreshTokens: StoredMcpOAuthRefreshToken[] = [];

  async findClientByClientId(
    clientId: string,
  ): Promise<StoredMcpOAuthClient | undefined> {
    return this.clients.get(clientId);
  }

  async upsertClient(
    input: CreateOAuthClientInput,
  ): Promise<StoredMcpOAuthClient> {
    const existing = this.clients.get(input.clientId);
    const now = new Date();
    const client: StoredMcpOAuthClient = {
      ...input,
      id: existing?.id ?? input.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.clients.set(client.clientId, client);
    return client;
  }

  async upsertAuthorization(input: {
    clientId: string;
    resource: string;
    scopes: McpScope[];
    userId: string;
  }): Promise<StoredMcpOAuthAuthorization> {
    const client = this.requireClient(input.clientId);
    const existing = this.authorizations.find(
      (authorization) =>
        authorization.userId === input.userId &&
        authorization.clientId === input.clientId &&
        authorization.resource === input.resource,
    );
    const authorization: StoredMcpOAuthAuthorization = {
      id: existing?.id ?? ulid(),
      userId: input.userId,
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      status: "ACTIVE",
      authorizedAt: new Date(),
      client,
    };

    if (existing) {
      Object.assign(existing, authorization);
      return existing;
    }

    this.authorizations.push(authorization);
    return authorization;
  }

  async createAuthorizationCode(
    input: CreateAuthorizationCodeInput,
  ): Promise<StoredMcpOAuthAuthorizationCode> {
    const code: StoredMcpOAuthAuthorizationCode = {
      ...input,
      codeChallengeMethod: "S256",
    };
    this.codes.push(code);
    return code;
  }

  async consumeAuthorizationCode(
    codeHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthAuthorizationCode | undefined> {
    const code = this.codes.find(
      (item) =>
        item.codeHash === codeHash && !item.consumedAt && item.expiresAt > now,
    );

    if (code) {
      code.consumedAt = now;
    }

    return code;
  }

  async createTokenPair(input: CreateTokenPairInput): Promise<void> {
    this.addTokenPair(input);
  }

  async findRefreshTokenByHash(
    tokenHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthRefreshToken | undefined> {
    return this.refreshTokens.find(
      (token) =>
        token.tokenHash === tokenHash &&
        !token.revokedAt &&
        token.expiresAt > now &&
        token.authorization.status === "ACTIVE",
    );
  }

  async rotateRefreshToken(input: RotateRefreshTokenInput): Promise<void> {
    const previous = this.refreshTokens.find(
      (token) =>
        token.id === input.previousRefreshTokenId && !token.revokedAt,
    );

    if (!previous) {
      throw new OAuthProtocolError("invalid_grant", "Refresh token is invalid");
    }

    previous.revokedAt = input.now;
    this.addTokenPair(input);
  }

  async findAccessTokenByHash(
    tokenHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthAccessToken | undefined> {
    return this.accessTokens.find(
      (token) =>
        token.tokenHash === tokenHash &&
        !token.revokedAt &&
        token.expiresAt > now &&
        token.authorization.status === "ACTIVE",
    );
  }

  async touchAccessToken(tokenId: string, lastUsedAt: Date): Promise<void> {
    const token = this.accessTokens.find((item) => item.id === tokenId);

    if (token) {
      token.authorization.lastUsedAt = lastUsedAt;
    }
  }

  async touchAuthorization(
    authorizationId: string,
    lastUsedAt: Date,
  ): Promise<void> {
    const authorization = this.authorizations.find(
      (item) => item.id === authorizationId,
    );

    if (authorization) {
      authorization.lastUsedAt = lastUsedAt;
    }
  }

  async revokeAccessTokenByHash(
    tokenHash: string,
    clientId: string | undefined,
    revokedAt: Date,
  ): Promise<void> {
    for (const token of this.accessTokens) {
      if (token.tokenHash === tokenHash && (!clientId || token.clientId === clientId)) {
        token.revokedAt = revokedAt;
      }
    }
  }

  async revokeRefreshTokenByHash(
    tokenHash: string,
    clientId: string | undefined,
    revokedAt: Date,
  ): Promise<void> {
    for (const token of this.refreshTokens) {
      if (token.tokenHash === tokenHash && (!clientId || token.clientId === clientId)) {
        token.revokedAt = revokedAt;
      }
    }
  }

  async listAuthorizedClients(userId: string): Promise<AuthorizedMcpClient[]> {
    return this.authorizations
      .filter((authorization) => authorization.userId === userId)
      .map((authorization) => ({
        clientId: authorization.clientId,
        clientName: authorization.client.clientName,
        clientUri: authorization.client.clientUri,
        scopes: authorization.scopes,
        authorizedAt: authorization.authorizedAt.toISOString(),
        lastUsedAt: authorization.lastUsedAt?.toISOString(),
        expiresAt: authorization.expiresAt?.toISOString(),
        status: authorization.status,
      }));
  }

  async revokeAuthorizationForUserClient(
    userId: string,
    clientId: string,
    revokedAt: Date,
  ): Promise<boolean> {
    const targets = this.authorizations.filter(
      (authorization) =>
        authorization.userId === userId &&
        authorization.clientId === clientId &&
        authorization.status === "ACTIVE",
    );

    for (const authorization of targets) {
      authorization.status = "REVOKED";
      authorization.revokedAt = revokedAt;
      for (const token of [...this.refreshTokens, ...this.accessTokens]) {
        if (token.authorizationId === authorization.id && !token.revokedAt) {
          token.revokedAt = revokedAt;
        }
      }
    }

    return targets.length > 0;
  }

  private addTokenPair(input: CreateTokenPairInput): void {
    const authorization = this.requireAuthorization(input.authorizationId);
    this.accessTokens.push({
      id: input.accessToken.id,
      tokenHash: input.accessToken.tokenHash,
      authorizationId: input.authorizationId,
      userId: input.userId,
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      expiresAt: input.accessToken.expiresAt,
      authorization,
    });
    this.refreshTokens.push({
      id: input.refreshToken.id,
      tokenHash: input.refreshToken.tokenHash,
      authorizationId: input.authorizationId,
      userId: input.userId,
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      expiresAt: input.refreshToken.expiresAt,
      authorization,
    });
  }

  private requireClient(clientId: string): StoredMcpOAuthClient {
    const client = this.clients.get(clientId);

    if (!client) {
      throw new Error(`Missing test client ${clientId}`);
    }

    return client;
  }

  private requireAuthorization(
    authorizationId: string,
  ): StoredMcpOAuthAuthorization {
    const authorization = this.authorizations.find(
      (item) => item.id === authorizationId,
    );

    if (!authorization) {
      throw new Error(`Missing test authorization ${authorizationId}`);
    }

    return authorization;
  }
}
