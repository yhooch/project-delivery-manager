import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import {
  toIdentitySession,
  toIdentityUser,
  toPrismaLocale,
  toPrismaThemeMode,
} from "./identity.mappers";
import type {
  CreateIdentitySessionInput,
  CreateIdentityUserInput,
  IdentitySession,
  IdentitySessionWithUser,
  IdentityUser,
  PublicIdentityUser,
  SessionRevocationReason,
  UpdateUserPreferencesInput,
} from "./identity.types";
import type { SessionRepository, UserRepository } from "./identity.repository";

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateIdentityUserInput): Promise<IdentityUser> {
    const user = await this.prisma.client.user.create({
      data: {
        id: input.id,
        username: input.username,
        passwordHash: input.passwordHash,
        name: input.name,
        locale: toPrismaLocale(input.locale),
        themeMode: toPrismaThemeMode(input.themeMode),
      },
    });

    return toIdentityUser(user);
  }

  async findById(id: string): Promise<IdentityUser | undefined> {
    const user = await this.prisma.client.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    return user ? toIdentityUser(user) : undefined;
  }

  async findByUsername(username: string): Promise<IdentityUser | undefined> {
    const user = await this.prisma.client.user.findFirst({
      where: {
        username,
        deletedAt: null,
      },
    });

    return user ? toIdentityUser(user) : undefined;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.client.user.update({
      data: {
        passwordHash,
      },
      where: {
        id: userId,
      },
    });
  }

  async updatePreferences(
    userId: string,
    input: UpdateUserPreferencesInput,
  ): Promise<PublicIdentityUser> {
    const user = await this.prisma.client.user.update({
      data: {
        locale: toPrismaLocale(input.locale),
        themeMode: toPrismaThemeMode(input.themeMode),
      },
      where: {
        id: userId,
      },
    });

    const { passwordHash: _passwordHash, ...publicUser } = toIdentityUser(user);
    return publicUser;
  }
}

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateIdentitySessionInput): Promise<IdentitySession> {
    const session = await this.prisma.client.session.create({
      data: {
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ip: input.ip,
      },
    });

    return toIdentitySession(session);
  }

  async findValidByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<IdentitySessionWithUser | undefined> {
    const session = await this.prisma.client.session.findFirst({
      include: {
        user: true,
      },
      where: {
        tokenHash,
        deletedAt: null,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
        user: {
          deletedAt: null,
          status: "ACTIVE",
        },
      },
    });

    return session
      ? {
          session: toIdentitySession(session),
          user: toIdentityUser(session.user),
        }
      : undefined;
  }

  async revokeById(
    sessionId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<void> {
    await this.prisma.client.session.updateMany({
      data: {
        revokedAt,
        revocationReason: reason,
      },
      where: {
        id: sessionId,
        revokedAt: null,
      },
    });
  }

  async revokeActiveByUserId(
    userId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<void> {
    await this.prisma.client.session.updateMany({
      data: {
        revokedAt,
        revocationReason: reason,
      },
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: revokedAt,
        },
      },
    });
  }

  async touch(sessionId: string, lastAccessedAt: Date): Promise<void> {
    await this.prisma.client.session.update({
      data: {
        lastAccessedAt,
      },
      where: {
        id: sessionId,
      },
    });
  }
}
