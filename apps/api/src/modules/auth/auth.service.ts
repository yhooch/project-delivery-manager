import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  UpdateUserPreferencesRequest,
} from "@project-delivery/shared";
import * as argon2 from "argon2";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { AuditService } from "../audit/audit.service";
import {
  USER_REPOSITORY,
  type UserRepository,
} from "../identity/identity.repository";
import { IdentityUserService } from "../identity/identity-user.service";
import type { IdentityUser } from "../identity/identity.types";
import { AppSessionService } from "../organization/app-session.service";
import { toSessionUser } from "./auth-session.builder";
import { AuthSessionService } from "./auth-session.service";
import type { AuthResult, RequestMetadata } from "./auth-session.types";
import { RateLimiterService } from "./rate-limiter.service";

const LOGIN_LIMIT = 5;
const REGISTER_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(IdentityUserService)
    private readonly identityUsers: IdentityUserService,
    @Inject(AuthSessionService)
    private readonly sessions: AuthSessionService,
    @Inject(AppSessionService)
    private readonly appSessions: AppSessionService,
    @Inject(RateLimiterService)
    private readonly rateLimiter: RateLimiterService,
    @Inject(AuditService)
    private readonly audit: AuditService,
  ) {}

  async register(
    input: RegisterRequest,
    metadata: RequestMetadata,
  ): Promise<AuthResult> {
    assertMatchingPasswords(input.password, input.confirmPassword);

    const username = normalizeUsername(input.username);
    const limiter = registerLimit(metadata.ip);
    this.rateLimiter.assertAllowed(limiter);
    this.rateLimiter.record(limiter);

    const existingUser = await this.users.findByUsername(username);

    if (existingUser) {
      throw new ApiException(
        "CONFLICT",
        "Username already exists",
        HttpStatus.CONFLICT,
      );
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.users.create({
      id: ulid(),
      username,
      passwordHash,
      name: username,
      locale: "zh-CN",
      themeMode: "SYSTEM",
    });
    const createdSession = await this.sessions.createSession(user, metadata);
    await this.audit.recordForUserOrganizations(user.id, {
      ...metadata,
      actionType: "LOGIN",
      metadata: { sessionId: createdSession.session.id, source: "register" },
      targetId: user.id,
      targetType: "USER",
    });

    return {
      appSession: await this.appSessions.buildForUser(toSessionUser(user)),
      cookie: {
        name: this.sessions.getCookieName(),
        token: createdSession.token,
        expiresAt: createdSession.session.expiresAt,
      },
    };
  }

  async login(input: LoginRequest, metadata: RequestMetadata): Promise<AuthResult> {
    const username = normalizeUsername(input.username);
    const limiter = loginLimit(username, metadata.ip);
    this.rateLimiter.assertAllowed(limiter);

    const user = await this.users.findByUsername(username);

    if (!user || !(await verifyPassword(user, input.password))) {
      this.rateLimiter.record(limiter);
      throwInvalidCredentials();
    }

    this.rateLimiter.reset(limiter.key);
    await this.sessions.rotateUserSessions(user.id);
    const createdSession = await this.sessions.createSession(user, metadata);
    await this.audit.recordForUserOrganizations(user.id, {
      ...metadata,
      actionType: "SESSION_REVOKED",
      metadata: { reason: "ROTATED" },
      targetId: user.id,
      targetType: "USER",
    });
    await this.audit.recordForUserOrganizations(user.id, {
      ...metadata,
      actionType: "LOGIN",
      metadata: { sessionId: createdSession.session.id },
      targetId: user.id,
      targetType: "USER",
    });

    return {
      appSession: await this.appSessions.buildForUser(toSessionUser(user)),
      cookie: {
        name: this.sessions.getCookieName(),
        token: createdSession.token,
        expiresAt: createdSession.session.expiresAt,
      },
    };
  }

  async logout(
    sessionId: string,
    userId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.sessions.revokeSession(sessionId);
    await this.audit.recordForUserOrganizations(userId, {
      ...metadata,
      actionType: "LOGOUT",
      targetId: sessionId,
      targetType: "SESSION",
    });
    await this.audit.recordForUserOrganizations(userId, {
      ...metadata,
      actionType: "SESSION_REVOKED",
      metadata: { reason: "LOGOUT" },
      targetId: sessionId,
      targetType: "SESSION",
    });
  }

  async changePassword(
    userId: string,
    input: ChangePasswordRequest,
    metadata: RequestMetadata,
  ): Promise<void> {
    assertMatchingPasswords(input.newPassword, input.confirmPassword);

    const user = await this.users.findById(userId);

    if (!user || !(await verifyPassword(user, input.oldPassword))) {
      throwInvalidCredentials();
    }

    await this.users.updatePassword(
      user.id,
      await hashPassword(input.newPassword),
    );
    await this.sessions.rotateUserSessions(user.id);
    await this.audit.recordForUserOrganizations(user.id, {
      ...metadata,
      actionType: "UPDATE",
      metadata: { operation: "CHANGE_PASSWORD", rotatedSessions: true },
      targetId: user.id,
      targetType: "USER",
    });
    await this.audit.recordForUserOrganizations(user.id, {
      ...metadata,
      actionType: "SESSION_REVOKED",
      metadata: { reason: "PASSWORD_CHANGED" },
      targetId: user.id,
      targetType: "USER",
    });
  }

  async updatePreferences(
    userId: string,
    input: UpdateUserPreferencesRequest,
  ): Promise<UpdateUserPreferencesRequest> {
    return this.identityUsers.updatePreferences(userId, input);
  }
}

function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
  });
}

async function verifyPassword(
  user: IdentityUser,
  password: string,
): Promise<boolean> {
  if (user.status !== "ACTIVE") {
    return false;
  }

  return argon2.verify(user.passwordHash, password);
}

function assertMatchingPasswords(password: string, confirmation: string): void {
  if (password !== confirmation) {
    throw new ApiException(
      "VALIDATION_ERROR",
      "Password confirmation does not match",
      HttpStatus.BAD_REQUEST,
    );
  }
}

function throwInvalidCredentials(): never {
  throw new ApiException(
    "INVALID_CREDENTIALS",
    "Invalid username or password",
    HttpStatus.UNAUTHORIZED,
  );
}

function loginLimit(username: string, ip: string | undefined) {
  return {
    key: `login:${username}:${ip ?? "unknown"}`,
    limit: LOGIN_LIMIT,
    windowMs: RATE_LIMIT_WINDOW_MS,
  };
}

function registerLimit(ip: string | undefined) {
  return {
    key: `register:${ip ?? "unknown"}`,
    limit: REGISTER_LIMIT,
    windowMs: RATE_LIMIT_WINDOW_MS,
  };
}
