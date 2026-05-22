import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { OAuthProtocolError } from "./oauth-protocol.error";
import { PrismaMcpOAuthRepository } from "./prisma-oauth.repository";

describe("PrismaMcpOAuthRepository", () => {
  it("maps refresh token rotation races to invalid_grant", async () => {
    const tx = {
      mcpOAuthAccessToken: {
        create: vi.fn(),
      },
      mcpOAuthRefreshToken: {
        create: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(
          async (callback: (transaction: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
      },
    } as unknown as PrismaService;
    const repository = new PrismaMcpOAuthRepository(prisma);

    await expect(
      repository.rotateRefreshToken({
        authorizationId: "01HRZ3NDEKTSV4RRFFQ69G5FA1",
        userId: "01HRZ3NDEKTSV4RRFFQ69G5FA2",
        clientId: "test-client",
        resource: "http://localhost:3001/api/v1/mcp",
        scopes: ["mcp:read"],
        previousRefreshTokenId: "01HRZ3NDEKTSV4RRFFQ69G5FA3",
        now: new Date("2026-05-22T00:00:00.000Z"),
        accessToken: {
          id: "01HRZ3NDEKTSV4RRFFQ69G5FA4",
          tokenHash: "access-token-hash",
          expiresAt: new Date("2026-05-22T01:00:00.000Z"),
        },
        refreshToken: {
          id: "01HRZ3NDEKTSV4RRFFQ69G5FA5",
          tokenHash: "refresh-token-hash",
          expiresAt: new Date("2026-06-21T00:00:00.000Z"),
        },
      }),
    ).rejects.toMatchObject({
      error: "invalid_grant",
    } satisfies Partial<OAuthProtocolError>);
    expect(tx.mcpOAuthAccessToken.create).not.toHaveBeenCalled();
    expect(tx.mcpOAuthRefreshToken.create).not.toHaveBeenCalled();
  });
});
