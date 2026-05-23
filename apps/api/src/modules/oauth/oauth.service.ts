import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  McpAuthorizePath,
  McpOAuthClientSchema,
  McpRegisterPath,
  McpRevokePath,
  McpTokenPath,
  type AuthorizedMcpClient,
  type McpAuthorizationServerMetadata,
  type McpOAuthAuthorizeContext,
  type McpOAuthAuthorizeQuery,
  type McpOAuthDynamicClientRegistrationRequest,
  type McpOAuthDynamicClientRegistrationResponse,
  type McpOAuthRevocationRequest,
  type McpOAuthTokenRequest,
  type McpOAuthTokenResponse,
  type McpProtectedResourceMetadata,
  type McpScope,
} from "@project-delivery/shared";
import { z } from "zod";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import type { McpOAuthPrincipalContext } from "../../http/request-context";
import { McpBearerAuthenticationError } from "./mcp-bearer-auth.error";
import { OAuthClientMetadataService } from "./oauth-client-metadata.service";
import { OAuthConfigService } from "./oauth-config.service";
import { OAuthProtocolError } from "./oauth-protocol.error";
import { MCP_SCOPE_VALUES, McpScopeRuntimeSchema } from "./oauth-scopes";
import { OAuthTokenService } from "./oauth-token.service";
import {
  MCP_OAUTH_REPOSITORY,
  type McpOAuthRepository,
  type PreparedAuthorization,
  type StoredMcpOAuthClient,
} from "./oauth.types";

const ScopeListSchema = z.array(McpScopeRuntimeSchema).min(1);
const dynamicClientGrantTypes = [
  "authorization_code",
  "refresh_token",
] as const;
const dynamicClientResponseTypes = ["code"] as const;
const defaultDynamicClientName = "MCP Dynamic Client";

@Injectable()
export class OAuthService {
  constructor(
    @Inject(MCP_OAUTH_REPOSITORY)
    private readonly repository: McpOAuthRepository,
    @Inject(OAuthTokenService)
    private readonly tokens: OAuthTokenService,
    @Inject(OAuthConfigService)
    private readonly oauthConfig: OAuthConfigService,
    @Inject(OAuthClientMetadataService)
    private readonly clientMetadata: OAuthClientMetadataService,
  ) {}

  getProtectedResourceMetadata(): McpProtectedResourceMetadata {
    return {
      resource: this.oauthConfig.getCanonicalResource(),
      authorization_servers: [this.oauthConfig.getIssuer()],
      scopes_supported: [...MCP_SCOPE_VALUES],
      resource_name: "PDM MCP",
      bearer_methods_supported: ["header"],
    };
  }

  getAuthorizationServerMetadata(): McpAuthorizationServerMetadata {
    return {
      issuer: this.oauthConfig.getIssuer(),
      authorization_endpoint: this.oauthConfig.absoluteUrl(McpAuthorizePath),
      token_endpoint: this.oauthConfig.absoluteUrl(McpTokenPath),
      revocation_endpoint: this.oauthConfig.absoluteUrl(McpRevokePath),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [...MCP_SCOPE_VALUES],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      registration_endpoint: this.oauthConfig.absoluteUrl(McpRegisterPath),
    };
  }

  async registerDynamicClient(
    request: McpOAuthDynamicClientRegistrationRequest,
  ): Promise<McpOAuthDynamicClientRegistrationResponse> {
    const now = new Date();
    const scopes = parseOptionalScopeString(request.scope);
    const clientName = request.client_name ?? defaultDynamicClientName;
    const client = await this.repository.upsertClient({
      id: ulid(),
      clientId: createDynamicClientId(),
      clientName,
      clientUri: request.client_uri,
      logoUri: request.logo_uri,
      redirectUris: request.redirect_uris,
      scopes,
      status: "ACTIVE",
      registrationMode: "DYNAMIC_CLIENT_REGISTRATION",
      metadataDocumentUri: undefined,
      metadataDocumentFetchedAt: undefined,
      metadataDocumentExpiresAt: undefined,
    });

    return {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      client_name: client.clientName,
      client_uri: client.clientUri,
      logo_uri: client.logoUri,
      redirect_uris: client.redirectUris,
      grant_types: [...dynamicClientGrantTypes],
      response_types: [...dynamicClientResponseTypes],
      scope: scopes.join(" "),
      token_endpoint_auth_method: "none",
    };
  }

  async prepareAuthorization(
    query: McpOAuthAuthorizeQuery,
    userId: string,
  ): Promise<PreparedAuthorization> {
    const now = new Date();
    this.assertCanonicalResource(query.resource);

    const client = await this.resolveClient(query.client_id, now);
    assertRedirectUriAllowed(client, query.redirect_uri);
    const scopes = parseScopeString(query.scope);
    assertScopesAllowed(client, scopes);

    const context = buildAuthorizeContext(client, query, scopes);

    return {
      context,
      grant: async () => {
        const authorization = await this.repository.upsertAuthorization({
          userId,
          clientId: client.clientId,
          resource: query.resource,
          scopes,
        });
        const code = this.tokens.createAuthorizationCode();
        const expiresAt = new Date(
          Date.now() + this.oauthConfig.getAuthorizationCodeTtlMs(),
        );

        await this.repository.createAuthorizationCode({
          id: ulid(),
          authorizationId: authorization.id,
          userId,
          clientId: client.clientId,
          redirectUri: query.redirect_uri,
          resource: query.resource,
          scopes,
          codeHash: this.tokens.hashToken(code),
          codeChallenge: query.code_challenge,
          expiresAt,
        });

        return {
          code,
          redirectTo: buildRedirectUri(query.redirect_uri, code, query.state),
        };
      },
    };
  }

  async exchangeToken(
    request: McpOAuthTokenRequest,
  ): Promise<McpOAuthTokenResponse> {
    this.assertCanonicalResource(request.resource);

    if (request.grant_type === "authorization_code") {
      return this.exchangeAuthorizationCode(request);
    }

    if (request.grant_type === "refresh_token") {
      return this.exchangeRefreshToken(request);
    }

    throw new OAuthProtocolError(
      "unsupported_grant_type",
      "Unsupported grant_type",
    );
  }

  async revokeToken(request: McpOAuthRevocationRequest): Promise<void> {
    const tokenHash = this.tokens.hashToken(request.token);
    const now = new Date();

    if (request.token_type_hint === "access_token") {
      await this.repository.revokeAccessTokenByHash(
        tokenHash,
        request.client_id,
        now,
      );
      return;
    }

    if (request.token_type_hint === "refresh_token") {
      await this.repository.revokeRefreshTokenByHash(
        tokenHash,
        request.client_id,
        now,
      );
      return;
    }

    await this.repository.revokeAccessTokenByHash(
      tokenHash,
      request.client_id,
      now,
    );
    await this.repository.revokeRefreshTokenByHash(
      tokenHash,
      request.client_id,
      now,
    );
  }

  async listAuthorizedClients(userId: string): Promise<AuthorizedMcpClient[]> {
    return this.repository.listAuthorizedClients(userId);
  }

  async revokeAuthorizedClient(
    userId: string,
    clientId: string,
  ): Promise<void> {
    const revoked = await this.repository.revokeAuthorizationForUserClient(
      userId,
      clientId,
      new Date(),
    );

    if (!revoked) {
      throw new ApiException(
        "MCP_CLIENT_NOT_FOUND",
        "MCP client authorization was not found",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async validateBearerToken(
    authorizationHeader: string | undefined,
    requiredScopes: McpScope[] = [],
  ): Promise<McpOAuthPrincipalContext> {
    const token = parseBearerToken(authorizationHeader);

    if (!token) {
      throw new McpBearerAuthenticationError(
        HttpStatus.UNAUTHORIZED,
        "invalid_token",
        "Bearer token is required",
        requiredScopes.join(" ") || undefined,
      );
    }

    const now = new Date();
    const accessToken = await this.repository.findAccessTokenByHash(
      this.tokens.hashToken(token),
      now,
    );

    if (!accessToken || accessToken.resource !== this.oauthConfig.getCanonicalResource()) {
      throw new McpBearerAuthenticationError(
        HttpStatus.UNAUTHORIZED,
        "invalid_token",
        "Bearer token is invalid or expired",
        requiredScopes.join(" ") || undefined,
      );
    }

    const missingScope = requiredScopes.find(
      (scope) => !accessToken.scopes.includes(scope),
    );

    if (missingScope) {
      throw new McpBearerAuthenticationError(
        HttpStatus.FORBIDDEN,
        "insufficient_scope",
        "Bearer token does not include the required scope",
        requiredScopes.join(" "),
      );
    }

    await this.repository.touchAccessToken(accessToken.id, now);
    await this.repository.touchAuthorization(accessToken.authorizationId, now);

    return {
      accessTokenId: accessToken.id,
      authorizationId: accessToken.authorizationId,
      userId: accessToken.userId,
      clientId: accessToken.clientId,
      resource: accessToken.resource,
      scopes: accessToken.scopes,
    };
  }

  buildBearerChallenge(input: {
    error?: "invalid_token" | "insufficient_scope";
    errorDescription?: string;
    scope?: string;
  } = {}): string {
    const parts = [
      `resource_metadata="${escapeHeaderValue(
        this.oauthConfig.getProtectedResourceMetadataUrl(),
      )}"`,
      `resource="${escapeHeaderValue(this.oauthConfig.getCanonicalResource())}"`,
    ];

    if (input.scope) {
      parts.push(`scope="${escapeHeaderValue(input.scope)}"`);
    }

    if (input.error) {
      parts.push(`error="${input.error}"`);
    }

    if (input.errorDescription) {
      parts.push(
        `error_description="${escapeHeaderValue(input.errorDescription)}"`,
      );
    }

    return `Bearer ${parts.join(", ")}`;
  }

  private async exchangeAuthorizationCode(request: Extract<
    McpOAuthTokenRequest,
    { grant_type: "authorization_code" }
  >): Promise<McpOAuthTokenResponse> {
    const now = new Date();
    const client = await this.resolveClient(request.client_id, now);
    assertRedirectUriAllowed(client, request.redirect_uri);

    const code = await this.repository.consumeAuthorizationCode(
      this.tokens.hashToken(request.code),
      now,
    );

    if (
      !code ||
      code.clientId !== client.clientId ||
      code.redirectUri !== request.redirect_uri ||
      code.resource !== request.resource ||
      !this.tokens.verifyCodeChallenge(
        request.code_verifier,
        code.codeChallenge,
      )
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "Authorization code is invalid",
      );
    }

    assertScopesAllowed(client, code.scopes);
    return this.issueTokenPair({
      authorizationId: code.authorizationId,
      userId: code.userId,
      clientId: code.clientId,
      resource: code.resource,
      scopes: code.scopes,
      rotateRefreshTokenId: undefined,
    });
  }

  private async exchangeRefreshToken(request: Extract<
    McpOAuthTokenRequest,
    { grant_type: "refresh_token" }
  >): Promise<McpOAuthTokenResponse> {
    const now = new Date();
    await this.resolveClient(request.client_id, now);

    const refreshToken = await this.repository.findRefreshTokenByHash(
      this.tokens.hashToken(request.refresh_token),
      now,
    );

    if (
      !refreshToken ||
      refreshToken.clientId !== request.client_id ||
      refreshToken.resource !== request.resource
    ) {
      throw new OAuthProtocolError("invalid_grant", "Refresh token is invalid");
    }

    const scopes = request.scope
      ? parseScopeString(request.scope)
      : refreshToken.scopes;

    if (!scopes.every((scope) => refreshToken.scopes.includes(scope))) {
      throw new OAuthProtocolError(
        "invalid_scope",
        "Requested scope exceeds refresh token scope",
      );
    }

    return this.issueTokenPair({
      authorizationId: refreshToken.authorizationId,
      userId: refreshToken.userId,
      clientId: refreshToken.clientId,
      resource: refreshToken.resource,
      scopes,
      rotateRefreshTokenId: refreshToken.id,
    });
  }

  private async issueTokenPair(input: {
    authorizationId: string;
    clientId: string;
    resource: string;
    rotateRefreshTokenId: string | undefined;
    scopes: McpScope[];
    userId: string;
  }): Promise<McpOAuthTokenResponse> {
    const now = new Date();
    const accessToken = this.tokens.createAccessToken();
    const refreshToken = this.tokens.createRefreshToken();
    const accessTokenTtlSeconds = this.oauthConfig.getAccessTokenTtlSeconds();
    const refreshTokenTtlSeconds = this.oauthConfig.getRefreshTokenTtlSeconds();
    const createInput = {
      authorizationId: input.authorizationId,
      userId: input.userId,
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      accessToken: {
        id: ulid(),
        tokenHash: this.tokens.hashToken(accessToken),
        expiresAt: new Date(now.getTime() + accessTokenTtlSeconds * 1000),
      },
      refreshToken: {
        id: ulid(),
        tokenHash: this.tokens.hashToken(refreshToken),
        expiresAt: new Date(now.getTime() + refreshTokenTtlSeconds * 1000),
      },
    };

    if (input.rotateRefreshTokenId) {
      await this.repository.rotateRefreshToken({
        ...createInput,
        previousRefreshTokenId: input.rotateRefreshTokenId,
        now,
      });
    } else {
      await this.repository.createTokenPair(createInput);
    }

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: input.scopes.join(" "),
    };
  }

  private assertCanonicalResource(resource: string): void {
    if (resource !== this.oauthConfig.getCanonicalResource()) {
      throw new OAuthProtocolError(
        "invalid_request",
        "OAuth resource does not match this MCP server",
      );
    }
  }

  private async resolveClient(
    clientId: string,
    now: Date,
  ): Promise<StoredMcpOAuthClient> {
    const existing = await this.repository.findClientByClientId(clientId);

    if (existing) {
      if (existing.status !== "ACTIVE") {
        throw new OAuthProtocolError("invalid_client", "OAuth client is disabled");
      }

      if (
        existing.registrationMode === "CLIENT_ID_METADATA_DOCUMENT" &&
        existing.metadataDocumentExpiresAt &&
        existing.metadataDocumentExpiresAt <= now
      ) {
        return this.refreshMetadataClient(clientId, now);
      }

      return existing;
    }

    const preRegistered = this.clientMetadata.findPreRegisteredClient(clientId);

    if (preRegistered) {
      return this.repository.upsertClient({
        id: ulid(),
        clientId: preRegistered.clientId,
        clientName: preRegistered.clientName,
        clientUri: preRegistered.clientUri,
        logoUri: preRegistered.logoUri,
        redirectUris: preRegistered.redirectUris,
        scopes: preRegistered.scopes,
        status: "ACTIVE",
        registrationMode: "PRE_REGISTERED",
        metadataDocumentUri: undefined,
        metadataDocumentFetchedAt: undefined,
        metadataDocumentExpiresAt: undefined,
      });
    }

    const metadataClient = await this.safeFetchMetadataClient(clientId, now);

    if (metadataClient) {
      return this.repository.upsertClient({
        id: ulid(),
        clientId: metadataClient.clientId,
        clientName: metadataClient.clientName,
        clientUri: metadataClient.clientUri,
        logoUri: metadataClient.logoUri,
        redirectUris: metadataClient.redirectUris,
        scopes: metadataClient.scopes,
        status: "ACTIVE",
        registrationMode: "CLIENT_ID_METADATA_DOCUMENT",
        metadataDocumentUri: metadataClient.metadataDocumentUri,
        metadataDocumentFetchedAt: metadataClient.metadataDocumentFetchedAt,
        metadataDocumentExpiresAt: metadataClient.metadataDocumentExpiresAt,
      });
    }

    throw new OAuthProtocolError("invalid_client", "OAuth client was not found");
  }

  private async refreshMetadataClient(
    clientId: string,
    now: Date,
  ): Promise<StoredMcpOAuthClient> {
    const metadataClient = await this.safeFetchMetadataClient(clientId, now);

    if (!metadataClient) {
      throw new OAuthProtocolError(
        "invalid_client",
        "OAuth client metadata document is unavailable",
      );
    }

    return this.repository.upsertClient({
      id: ulid(),
      clientId: metadataClient.clientId,
      clientName: metadataClient.clientName,
      clientUri: metadataClient.clientUri,
      logoUri: metadataClient.logoUri,
      redirectUris: metadataClient.redirectUris,
      scopes: metadataClient.scopes,
      status: "ACTIVE",
      registrationMode: "CLIENT_ID_METADATA_DOCUMENT",
      metadataDocumentUri: metadataClient.metadataDocumentUri,
      metadataDocumentFetchedAt: metadataClient.metadataDocumentFetchedAt,
      metadataDocumentExpiresAt: metadataClient.metadataDocumentExpiresAt,
    });
  }

  private async safeFetchMetadataClient(clientId: string, now: Date) {
    try {
      return await this.clientMetadata.fetchMetadataDocument(clientId, now);
    } catch {
      throw new OAuthProtocolError(
        "invalid_client",
        "OAuth client metadata document is unavailable",
      );
    }
  }
}

function parseScopeString(scope: string): McpScope[] {
  return ScopeListSchema.parse(scope.split(/\s+/u).filter(Boolean));
}

function parseOptionalScopeString(scope: string | undefined): McpScope[] {
  if (!scope) {
    return [...MCP_SCOPE_VALUES];
  }

  return [...new Set(parseScopeString(scope))];
}

function createDynamicClientId(): string {
  return `mcp_dcr_${ulid()}`;
}

function assertRedirectUriAllowed(
  client: StoredMcpOAuthClient,
  redirectUri: string,
): void {
  if (!client.redirectUris.includes(redirectUri)) {
    throw new OAuthProtocolError(
      "invalid_request",
      "redirect_uri does not exactly match the client registration",
    );
  }
}

function assertScopesAllowed(
  client: StoredMcpOAuthClient,
  scopes: McpScope[],
): void {
  if (!scopes.every((scope) => client.scopes.includes(scope))) {
    throw new OAuthProtocolError(
      "invalid_scope",
      "Requested scope is not registered for this client",
    );
  }
}

function buildAuthorizeContext(
  client: StoredMcpOAuthClient,
  query: McpOAuthAuthorizeQuery,
  scopes: McpScope[],
): McpOAuthAuthorizeContext {
  const redirect = new URL(query.redirect_uri);

  return {
    client: McpOAuthClientSchema.parse({
      clientId: client.clientId,
      clientName: client.clientName,
      clientUri: client.clientUri,
      redirectUris: client.redirectUris,
      scopes: client.scopes,
      status: client.status,
      registrationMode: client.registrationMode,
      metadataDocumentUri: client.metadataDocumentUri,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    }),
    redirectUri: query.redirect_uri,
    redirectHostname: redirect.hostname,
    redirectIsLocalhost: isLocalhostRedirect(redirect),
    resource: query.resource,
    scopes,
    state: query.state,
  };
}

function isLocalhostRedirect(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  );
}

function buildRedirectUri(
  redirectUri: string,
  code: string,
  state: string | undefined,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);

  if (state) {
    url.searchParams.set("state", state);
  }

  return url.toString();
}

function parseBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (!authorizationHeader) {
    return undefined;
  }

  const [scheme, token, extra] = authorizationHeader.split(/\s+/u);

  if (extra || !scheme || !token || scheme.toLowerCase() !== "bearer") {
    return undefined;
  }

  return token;
}

function escapeHeaderValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
