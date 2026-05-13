import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ulid } from "ulid";

import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from "../identity/identity.repository";
import type { PublicIdentityUser } from "../identity/identity.types";
import { toSessionUser } from "./auth-session.builder";
import type {
  AuthSessionContext,
  CreatedSession,
  RequestMetadata,
} from "./auth-session.types";
import { SessionTokenService } from "./session-token.service";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

@Injectable()
export class AuthSessionService {
  constructor(
    @Inject(SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(ConfigService)
    private readonly config: ConfigService,
    @Inject(SessionTokenService)
    private readonly tokens: SessionTokenService,
  ) {}

  getCookieName(): string {
    return this.config.get<string>("SESSION_COOKIE_NAME") ?? "pdm_session";
  }

  async createSession(
    user: PublicIdentityUser,
    metadata: RequestMetadata,
  ): Promise<CreatedSession> {
    const token = this.tokens.createToken();
    const tokenHash = this.tokens.hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const session = await this.sessions.create({
      id: ulid(),
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: metadata.userAgent,
      ip: metadata.ip,
    });

    return {
      session,
      token,
    };
  }

  async resolveToken(token: string | undefined): Promise<AuthSessionContext | undefined> {
    if (!token) {
      return undefined;
    }

    const tokenHash = this.tokens.hashToken(token);
    const result = await this.sessions.findValidByTokenHash(tokenHash, new Date());

    if (!result) {
      return undefined;
    }

    await this.sessions.touch(result.session.id, new Date());

    return {
      session: {
        sessionId: result.session.id,
        userId: result.user.id,
        tokenHash,
        expiresAt: result.session.expiresAt,
      },
      user: toSessionUser(result.user),
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sessions.revokeById(sessionId, "LOGOUT", new Date());
  }

  async rotateUserSessions(userId: string): Promise<void> {
    await this.sessions.revokeActiveByUserId(userId, "ROTATED", new Date());
  }
}
