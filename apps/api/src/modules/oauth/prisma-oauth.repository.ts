import { Inject, Injectable } from "@nestjs/common";
import {
  McpOAuthClientRegistrationModeSchema,
  McpOAuthClientStatusSchema,
  type AuthorizedMcpClient,
  type McpScope,
} from "@project-delivery/shared";
import { z } from "zod";
import { ulid } from "ulid";

import { PrismaService } from "../../prisma/prisma.service";
import { McpScopeRuntimeSchema } from "./oauth-scopes";
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

type PrismaClientRecord = {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  createdAt: Date;
  deletedAt?: Date | null;
  id: string;
  logoUri: string | null;
  metadataDocumentExpiresAt: Date | null;
  metadataDocumentFetchedAt: Date | null;
  metadataDocumentUri: string | null;
  redirectUris: string[];
  registrationMode: unknown;
  scopes: string[];
  status: unknown;
  updatedAt: Date;
};

type PrismaAuthorizationRecord = {
  authorizedAt: Date;
  client: PrismaClientRecord;
  clientId: string;
  expiresAt: Date | null;
  id: string;
  lastUsedAt: Date | null;
  resource: string;
  revokedAt: Date | null;
  scopes: string[];
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  userId: string;
};

type PrismaAuthorizationCodeRecord = {
  authorizationId: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  codeHash: string;
  consumedAt: Date | null;
  expiresAt: Date;
  id: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  userId: string;
};

type PrismaAccessTokenRecord = {
  authorization: PrismaAuthorizationRecord;
  authorizationId: string;
  clientId: string;
  expiresAt: Date;
  id: string;
  resource: string;
  revokedAt: Date | null;
  scopes: string[];
  tokenHash: string;
  userId: string;
};

type PrismaRefreshTokenRecord = PrismaAccessTokenRecord;

const ScopeListSchema = z.array(McpScopeRuntimeSchema).min(1);

@Injectable()
export class PrismaMcpOAuthRepository implements McpOAuthRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async findClientByClientId(
    clientId: string,
  ): Promise<StoredMcpOAuthClient | undefined> {
    const client = await this.prisma.client.mcpOAuthClient.findFirst({
      where: {
        clientId,
        deletedAt: null,
      },
    });

    return client ? toStoredClient(client as PrismaClientRecord) : undefined;
  }

  async upsertClient(
    input: CreateOAuthClientInput,
  ): Promise<StoredMcpOAuthClient> {
    const client = await this.prisma.client.mcpOAuthClient.upsert({
      create: {
        id: input.id,
        clientId: input.clientId,
        clientName: input.clientName,
        clientUri: input.clientUri,
        logoUri: input.logoUri,
        redirectUris: input.redirectUris,
        scopes: input.scopes,
        status: input.status,
        registrationMode: input.registrationMode,
        metadataDocumentUri: input.metadataDocumentUri,
        metadataDocumentFetchedAt: input.metadataDocumentFetchedAt,
        metadataDocumentExpiresAt: input.metadataDocumentExpiresAt,
      },
      update: {
        clientName: input.clientName,
        clientUri: input.clientUri,
        logoUri: input.logoUri,
        redirectUris: input.redirectUris,
        scopes: input.scopes,
        status: input.status,
        registrationMode: input.registrationMode,
        metadataDocumentUri: input.metadataDocumentUri,
        metadataDocumentFetchedAt: input.metadataDocumentFetchedAt,
        metadataDocumentExpiresAt: input.metadataDocumentExpiresAt,
        deletedAt: null,
      },
      where: {
        clientId: input.clientId,
      },
    });

    return toStoredClient(client as PrismaClientRecord);
  }

  async upsertAuthorization(input: {
    clientId: string;
    resource: string;
    scopes: McpScope[];
    userId: string;
  }): Promise<StoredMcpOAuthAuthorization> {
    const now = new Date();
    const authorization = await this.prisma.client.mcpOAuthAuthorization.upsert({
      create: {
        id: inputId(),
        userId: input.userId,
        clientId: input.clientId,
        resource: input.resource,
        scopes: input.scopes,
      },
      include: {
        client: true,
      },
      update: {
        scopes: input.scopes,
        status: "ACTIVE",
        authorizedAt: now,
        revokedAt: null,
        expiresAt: null,
      },
      where: {
        userId_clientId_resource: {
          userId: input.userId,
          clientId: input.clientId,
          resource: input.resource,
        },
      },
    });

    return toStoredAuthorization(authorization as PrismaAuthorizationRecord);
  }

  async createAuthorizationCode(
    input: CreateAuthorizationCodeInput,
  ): Promise<StoredMcpOAuthAuthorizationCode> {
    const code = await this.prisma.client.mcpOAuthAuthorizationCode.create({
      data: {
        id: input.id,
        codeHash: input.codeHash,
        authorizationId: input.authorizationId,
        userId: input.userId,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        resource: input.resource,
        scopes: input.scopes,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: "S256",
        expiresAt: input.expiresAt,
      },
    });

    return toStoredCode(code as PrismaAuthorizationCodeRecord);
  }

  async consumeAuthorizationCode(
    codeHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthAuthorizationCode | undefined> {
    return this.prisma.client.$transaction(async (tx) => {
      const code = await tx.mcpOAuthAuthorizationCode.findFirst({
        where: {
          codeHash,
          consumedAt: null,
          expiresAt: {
            gt: now,
          },
        },
      });

      if (!code) {
        return undefined;
      }

      const result = await tx.mcpOAuthAuthorizationCode.updateMany({
        data: {
          consumedAt: now,
        },
        where: {
          id: code.id,
          consumedAt: null,
        },
      });

      return result.count === 1
        ? toStoredCode(code as PrismaAuthorizationCodeRecord)
        : undefined;
    });
  }

  async createTokenPair(input: CreateTokenPairInput): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.mcpOAuthAccessToken.create({
        data: {
          id: input.accessToken.id,
          tokenHash: input.accessToken.tokenHash,
          authorizationId: input.authorizationId,
          userId: input.userId,
          clientId: input.clientId,
          resource: input.resource,
          scopes: input.scopes,
          expiresAt: input.accessToken.expiresAt,
        },
      });
      await tx.mcpOAuthRefreshToken.create({
        data: {
          id: input.refreshToken.id,
          tokenHash: input.refreshToken.tokenHash,
          authorizationId: input.authorizationId,
          userId: input.userId,
          clientId: input.clientId,
          resource: input.resource,
          scopes: input.scopes,
          expiresAt: input.refreshToken.expiresAt,
        },
      });
    });
  }

  async findRefreshTokenByHash(
    tokenHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthRefreshToken | undefined> {
    const token = await this.prisma.client.mcpOAuthRefreshToken.findFirst({
      include: {
        authorization: {
          include: {
            client: true,
          },
        },
      },
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
        authorization: {
          status: "ACTIVE",
          revokedAt: null,
          client: {
            status: "ACTIVE",
            deletedAt: null,
          },
        },
        user: {
          deletedAt: null,
          status: "ACTIVE",
        },
      },
    });

    return token
      ? toStoredRefreshToken(token as PrismaRefreshTokenRecord)
      : undefined;
  }

  async rotateRefreshToken(input: RotateRefreshTokenInput): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.mcpOAuthRefreshToken.updateMany({
        data: {
          revokedAt: input.now,
          revocationReason: "ROTATED",
        },
        where: {
          id: input.previousRefreshTokenId,
          revokedAt: null,
        },
      });

      if (result.count !== 1) {
        throw new Error("Refresh token was already rotated");
      }

      await tx.mcpOAuthAccessToken.create({
        data: {
          id: input.accessToken.id,
          tokenHash: input.accessToken.tokenHash,
          authorizationId: input.authorizationId,
          userId: input.userId,
          clientId: input.clientId,
          resource: input.resource,
          scopes: input.scopes,
          expiresAt: input.accessToken.expiresAt,
        },
      });
      await tx.mcpOAuthRefreshToken.create({
        data: {
          id: input.refreshToken.id,
          tokenHash: input.refreshToken.tokenHash,
          authorizationId: input.authorizationId,
          userId: input.userId,
          clientId: input.clientId,
          resource: input.resource,
          scopes: input.scopes,
          expiresAt: input.refreshToken.expiresAt,
        },
      });
    });
  }

  async findAccessTokenByHash(
    tokenHash: string,
    now: Date,
  ): Promise<StoredMcpOAuthAccessToken | undefined> {
    const token = await this.prisma.client.mcpOAuthAccessToken.findFirst({
      include: {
        authorization: {
          include: {
            client: true,
          },
        },
      },
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
        authorization: {
          status: "ACTIVE",
          revokedAt: null,
          client: {
            status: "ACTIVE",
            deletedAt: null,
          },
        },
        user: {
          deletedAt: null,
          status: "ACTIVE",
        },
      },
    });

    return token ? toStoredAccessToken(token as PrismaAccessTokenRecord) : undefined;
  }

  async touchAccessToken(tokenId: string, lastUsedAt: Date): Promise<void> {
    await this.prisma.client.mcpOAuthAccessToken.update({
      data: {
        lastUsedAt,
      },
      where: {
        id: tokenId,
      },
    });
  }

  async touchAuthorization(
    authorizationId: string,
    lastUsedAt: Date,
  ): Promise<void> {
    await this.prisma.client.mcpOAuthAuthorization.update({
      data: {
        lastUsedAt,
      },
      where: {
        id: authorizationId,
      },
    });
  }

  async revokeAccessTokenByHash(
    tokenHash: string,
    clientId: string | undefined,
    revokedAt: Date,
  ): Promise<void> {
    await this.prisma.client.mcpOAuthAccessToken.updateMany({
      data: {
        revokedAt,
        revocationReason: "REVOKED",
      },
      where: compactTokenWhere(tokenHash, clientId),
    });
  }

  async revokeRefreshTokenByHash(
    tokenHash: string,
    clientId: string | undefined,
    revokedAt: Date,
  ): Promise<void> {
    await this.prisma.client.mcpOAuthRefreshToken.updateMany({
      data: {
        revokedAt,
        revocationReason: "REVOKED",
      },
      where: compactTokenWhere(tokenHash, clientId),
    });
  }

  async listAuthorizedClients(userId: string): Promise<AuthorizedMcpClient[]> {
    const now = new Date();
    const authorizations =
      await this.prisma.client.mcpOAuthAuthorization.findMany({
        include: {
          client: true,
        },
        orderBy: {
          authorizedAt: "desc",
        },
        where: {
          userId,
        },
      });

    return authorizations.map((authorization) => {
      const stored = toStoredAuthorization(
        authorization as PrismaAuthorizationRecord,
      );
      const status =
        stored.expiresAt && stored.expiresAt <= now ? "EXPIRED" : stored.status;

      return {
        clientId: stored.clientId,
        clientName: stored.client.clientName,
        clientUri: stored.client.clientUri,
        scopes: stored.scopes,
        authorizedAt: stored.authorizedAt.toISOString(),
        lastUsedAt: stored.lastUsedAt?.toISOString(),
        expiresAt: stored.expiresAt?.toISOString(),
        status,
      };
    });
  }

  async revokeAuthorizationForUserClient(
    userId: string,
    clientId: string,
    revokedAt: Date,
  ): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
      const authorizations = await tx.mcpOAuthAuthorization.findMany({
        select: {
          id: true,
        },
        where: {
          userId,
          clientId,
          status: "ACTIVE",
          revokedAt: null,
        },
      });

      if (authorizations.length === 0) {
        return false;
      }

      const authorizationIds = authorizations.map(
        (authorization) => authorization.id,
      );

      await tx.mcpOAuthAuthorization.updateMany({
        data: {
          status: "REVOKED",
          revokedAt,
        },
        where: {
          id: {
            in: authorizationIds,
          },
        },
      });
      await tx.mcpOAuthRefreshToken.updateMany({
        data: {
          revokedAt,
          revocationReason: "AUTHORIZATION_REVOKED",
        },
        where: {
          authorizationId: {
            in: authorizationIds,
          },
          revokedAt: null,
        },
      });
      await tx.mcpOAuthAccessToken.updateMany({
        data: {
          revokedAt,
          revocationReason: "AUTHORIZATION_REVOKED",
        },
        where: {
          authorizationId: {
            in: authorizationIds,
          },
          revokedAt: null,
        },
      });

      return true;
    });
  }
}

function toStoredClient(client: PrismaClientRecord): StoredMcpOAuthClient {
  return {
    id: client.id,
    clientId: client.clientId,
    clientName: client.clientName,
    clientUri: client.clientUri ?? undefined,
    logoUri: client.logoUri ?? undefined,
    redirectUris: client.redirectUris,
    scopes: parseScopes(client.scopes),
    status: McpOAuthClientStatusSchema.parse(client.status),
    registrationMode: McpOAuthClientRegistrationModeSchema.parse(
      client.registrationMode,
    ),
    metadataDocumentUri: client.metadataDocumentUri ?? undefined,
    metadataDocumentFetchedAt: client.metadataDocumentFetchedAt ?? undefined,
    metadataDocumentExpiresAt: client.metadataDocumentExpiresAt ?? undefined,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function toStoredAuthorization(
  authorization: PrismaAuthorizationRecord,
): StoredMcpOAuthAuthorization {
  return {
    id: authorization.id,
    userId: authorization.userId,
    clientId: authorization.clientId,
    resource: authorization.resource,
    scopes: parseScopes(authorization.scopes),
    status: authorization.status,
    authorizedAt: authorization.authorizedAt,
    lastUsedAt: authorization.lastUsedAt ?? undefined,
    expiresAt: authorization.expiresAt ?? undefined,
    revokedAt: authorization.revokedAt ?? undefined,
    client: toStoredClient(authorization.client),
  };
}

function toStoredCode(
  code: PrismaAuthorizationCodeRecord,
): StoredMcpOAuthAuthorizationCode {
  return {
    id: code.id,
    codeHash: code.codeHash,
    authorizationId: code.authorizationId,
    userId: code.userId,
    clientId: code.clientId,
    redirectUri: code.redirectUri,
    resource: code.resource,
    scopes: parseScopes(code.scopes),
    codeChallenge: code.codeChallenge,
    codeChallengeMethod: "S256",
    expiresAt: code.expiresAt,
    consumedAt: code.consumedAt ?? undefined,
  };
}

function toStoredRefreshToken(
  token: PrismaRefreshTokenRecord,
): StoredMcpOAuthRefreshToken {
  return {
    id: token.id,
    tokenHash: token.tokenHash,
    authorizationId: token.authorizationId,
    userId: token.userId,
    clientId: token.clientId,
    resource: token.resource,
    scopes: parseScopes(token.scopes),
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt ?? undefined,
    authorization: toStoredAuthorization(token.authorization),
  };
}

function toStoredAccessToken(
  token: PrismaAccessTokenRecord,
): StoredMcpOAuthAccessToken {
  return {
    id: token.id,
    tokenHash: token.tokenHash,
    authorizationId: token.authorizationId,
    userId: token.userId,
    clientId: token.clientId,
    resource: token.resource,
    scopes: parseScopes(token.scopes),
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt ?? undefined,
    authorization: toStoredAuthorization(token.authorization),
  };
}

function parseScopes(scopes: string[]): McpScope[] {
  return ScopeListSchema.parse(scopes);
}

function compactTokenWhere(
  tokenHash: string,
  clientId: string | undefined,
): { clientId?: string; tokenHash: string } {
  return clientId ? { clientId, tokenHash } : { tokenHash };
}

function inputId(): string {
  return ulid();
}
