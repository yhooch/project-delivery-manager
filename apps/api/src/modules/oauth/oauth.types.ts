import type {
  AuthorizedMcpClient,
  McpOAuthAuthorizeContext,
  McpOAuthClientRegistrationMode,
  McpOAuthClientStatus,
  McpScope,
} from "@project-delivery/shared";

export type StoredMcpOAuthClient = {
  id: string;
  clientId: string;
  clientName: string;
  clientUri?: string;
  logoUri?: string;
  redirectUris: string[];
  scopes: McpScope[];
  status: McpOAuthClientStatus;
  registrationMode: McpOAuthClientRegistrationMode;
  metadataDocumentUri?: string;
  metadataDocumentFetchedAt?: Date;
  metadataDocumentExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredMcpOAuthAuthorization = {
  id: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: McpScope[];
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  authorizedAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  client: StoredMcpOAuthClient;
};

export type StoredMcpOAuthAuthorizationCode = {
  id: string;
  codeHash: string;
  authorizationId: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: McpScope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: Date;
  consumedAt?: Date;
};

export type StoredMcpOAuthRefreshToken = {
  id: string;
  tokenHash: string;
  authorizationId: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: McpScope[];
  expiresAt: Date;
  revokedAt?: Date;
  authorization: StoredMcpOAuthAuthorization;
};

export type StoredMcpOAuthAccessToken = {
  id: string;
  tokenHash: string;
  authorizationId: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: McpScope[];
  expiresAt: Date;
  revokedAt?: Date;
  authorization: StoredMcpOAuthAuthorization;
};

export type CreateOAuthClientInput = Omit<
  StoredMcpOAuthClient,
  "createdAt" | "id" | "updatedAt"
> & {
  id: string;
};

export type CreateAuthorizationCodeInput = {
  id: string;
  authorizationId: string;
  clientId: string;
  codeHash: string;
  codeChallenge: string;
  expiresAt: Date;
  redirectUri: string;
  resource: string;
  scopes: McpScope[];
  userId: string;
};

export type CreateTokenPairInput = {
  accessToken: {
    id: string;
    tokenHash: string;
    expiresAt: Date;
  };
  authorizationId: string;
  clientId: string;
  refreshToken: {
    id: string;
    tokenHash: string;
    expiresAt: Date;
  };
  resource: string;
  scopes: McpScope[];
  userId: string;
};

export type RotateRefreshTokenInput = CreateTokenPairInput & {
  previousRefreshTokenId: string;
  now: Date;
};

export type McpOAuthRepository = {
  consumeAuthorizationCode(
    codeHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthAuthorizationCode | undefined>;
  createAuthorizationCode(
    input: CreateAuthorizationCodeInput,
  ): Promise<StoredMcpOAuthAuthorizationCode>;
  createTokenPair(input: CreateTokenPairInput): Promise<void>;
  findAccessTokenByHash(
    tokenHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthAccessToken | undefined>;
  findClientByClientId(
    clientId: string,
  ): Promise<StoredMcpOAuthClient | undefined>;
  findRefreshTokenByHash(
    tokenHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthRefreshToken | undefined>;
  listAuthorizedClients(userId: string): Promise<AuthorizedMcpClient[]>;
  revokeAccessTokenByHash(
    tokenHash: string,
    clientId: string | undefined,
    revokedAt: Date,
  ): Promise<void>;
  revokeAuthorizationForUserClient(
    userId: string,
    clientId: string,
    revokedAt: Date,
  ): Promise<boolean>;
  revokeRefreshTokenByHash(
    tokenHash: string,
    clientId: string | undefined,
    revokedAt: Date,
  ): Promise<void>;
  rotateRefreshToken(input: RotateRefreshTokenInput): Promise<void>;
  touchAccessToken(tokenId: string, lastUsedAt: Date): Promise<void>;
  touchAuthorization(authorizationId: string, lastUsedAt: Date): Promise<void>;
  upsertAuthorization(input: {
    clientId: string;
    resource: string;
    scopes: McpScope[];
    userId: string;
  }): Promise<StoredMcpOAuthAuthorization>;
  upsertClient(input: CreateOAuthClientInput): Promise<StoredMcpOAuthClient>;
};

export type PreparedAuthorization = {
  context: McpOAuthAuthorizeContext;
  grant(): Promise<{
    code: string;
    redirectTo: string;
  }>;
};

export const MCP_OAUTH_REPOSITORY = Symbol("MCP_OAUTH_REPOSITORY");
