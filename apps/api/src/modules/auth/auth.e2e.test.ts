import { type INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { configureApp } from "../../main";
import {
  SESSION_REPOSITORY,
  USER_REPOSITORY,
  type SessionRepository,
  type UserRepository,
} from "../identity/identity.repository";
import type {
  CreateIdentitySessionInput,
  CreateIdentityUserInput,
  IdentitySession,
  IdentitySessionWithUser,
  IdentityUser,
  PublicIdentityUser,
  SessionRevocationReason,
  UpdateUserPreferencesInput,
} from "../identity/identity.types";
import { AuthSessionService } from "./auth-session.service";

const ORIGIN = "http://localhost:3000";

describe("auth and session API", () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let users: InMemoryUserRepository;
  let sessions: InMemorySessionRepository;

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??=
      "postgresql://postgres:postgres@localhost:5432/project_delivery_manager";
    process.env["NODE_ENV"] = "test";
    process.env["SESSION_COOKIE_NAME"] = "pdm_session";
    process.env["WEB_APP_URL"] = ORIGIN;

    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository(users);
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(USER_REPOSITORY)
      .useValue(users)
      .overrideProvider(SESSION_REPOSITORY)
      .useValue(sessions)
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers a user and creates a hashed database session", async () => {
    const response = await registerUser("register_ok", "203.0.113.10").expect(
      200,
    );
    const token = extractSessionToken(response.headers["set-cookie"]);

    expect(response.body.data.user).toMatchObject({
      username: "register_ok",
      name: "register_ok",
      preferences: {
        locale: "zh-CN",
        themeMode: "SYSTEM",
      },
    });
    expect(token).toBeTruthy();
    expect(sessions.records).toHaveLength(1);
    expect(sessions.records[0]?.tokenHash).not.toBe(token);
    expect(sessions.records[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects duplicate usernames", async () => {
    await registerUser("duplicate_user", "203.0.113.11").expect(200);

    const response = await registerUser(
      "duplicate_user",
      "203.0.113.12",
    ).expect(409);

    expect(response.body).toMatchObject({
      code: "CONFLICT",
    });
  });

  it("logs in and rotates the previous user session", async () => {
    await registerUser("login_ok", "203.0.113.13").expect(200);
    const previousSession = sessions.records.find(
      (session) => session.userId === users.getByUsername("login_ok")?.id,
    );

    const response = await loginUser(
      "login_ok",
      "password-123",
      "203.0.113.14",
    ).expect(200);

    expect(response.body.data.user.username).toBe("login_ok");
    expect(extractSessionToken(response.headers["set-cookie"])).toBeTruthy();
    expect(previousSession?.revocationReason).toBe("ROTATED");
  });

  it("does not reveal whether the username exists for invalid credentials", async () => {
    await registerUser("known_user", "203.0.113.15").expect(200);

    const existing = await loginUser(
      "known_user",
      "wrong-password",
      "203.0.113.16",
    ).expect(401);
    const missing = await loginUser(
      "missing_user",
      "wrong-password",
      "203.0.113.16",
    ).expect(401);

    expect(existing.body).toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password",
    });
    expect(missing.body).toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password",
    });
  });

  it("rejects write requests with missing or untrusted origins", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        username: "missing_origin_user",
        password: "password-123",
        confirmPassword: "password-123",
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("FORBIDDEN");
      });

    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .set("Origin", "http://evil.example")
      .set("x-forwarded-host", "evil.example")
      .set("x-forwarded-proto", "http")
      .send({
        username: "spoofed_origin_user",
        password: "password-123",
        confirmPassword: "password-123",
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("FORBIDDEN");
      });
  });

  it("revokes the current session on logout", async () => {
    const agent = request.agent(app.getHttpServer());
    await post(agent, "/api/v1/auth/register", "203.0.113.17")
      .send({
        username: "logout_user",
        password: "password-123",
        confirmPassword: "password-123",
      })
      .expect(200);
    await agent.get("/api/v1/demo/protected").expect(200);

    await post(agent, "/api/v1/auth/logout", "203.0.113.17")
      .send({})
      .expect(200);
    await agent.get("/api/v1/demo/protected").expect(401);
  });

  it("rate limits repeated login failures by username and IP", async () => {
    await registerUser("limited_user", "203.0.113.18").expect(200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await loginUser("limited_user", "wrong-password", "203.0.113.19").expect(
        401,
      );
    }

    const response = await loginUser(
      "limited_user",
      "wrong-password",
      "203.0.113.19",
    ).expect(429);

    expect(response.body).toMatchObject({
      code: "RATE_LIMITED",
      details: {
        retryAfterSeconds: expect.any(Number),
      },
    });
  });

  it("updates preferences and exposes them through reusable session resolution", async () => {
    const agent = request.agent(app.getHttpServer());
    const registerResponse = await post(
      agent,
      "/api/v1/auth/register",
      "203.0.113.20",
    )
      .send({
        username: "pref_user",
        password: "password-123",
        confirmPassword: "password-123",
      })
      .expect(200);
    const token = extractSessionToken(registerResponse.headers["set-cookie"]);

    await patch(agent, "/api/v1/users/me/preferences", "203.0.113.20")
      .send({
        locale: "en-US",
        themeMode: "DARK",
      })
      .expect(200);

    const resolved = await moduleRef
      .get(AuthSessionService)
      .resolveToken(token);

    expect(resolved?.user.preferences).toEqual({
      locale: "en-US",
      themeMode: "DARK",
    });
    await agent
      .get("/api/v1/demo/protected")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.preferences).toEqual({
          locale: "en-US",
          themeMode: "DARK",
        });
      });
  });

  function registerUser(username: string, ip: string) {
    return post(request(app.getHttpServer()), "/api/v1/auth/register", ip).send(
      {
        username,
        password: "password-123",
        confirmPassword: "password-123",
      },
    );
  }

  function loginUser(username: string, password: string, ip: string) {
    return post(request(app.getHttpServer()), "/api/v1/auth/login", ip).send({
      username,
      password,
    });
  }

  function post(
    client: request.Agent | request.SuperTest<request.Test>,
    url: string,
    ip: string,
  ) {
    return client.post(url).set("Origin", ORIGIN).set("x-forwarded-for", ip);
  }

  function patch(
    client: request.Agent | request.SuperTest<request.Test>,
    url: string,
    ip: string,
  ) {
    return client.patch(url).set("Origin", ORIGIN).set("x-forwarded-for", ip);
  }
});

function extractSessionToken(cookies: string[] | string | undefined): string {
  const cookie = Array.isArray(cookies) ? cookies[0] : cookies;

  if (!cookie) {
    throw new Error("Expected Set-Cookie header");
  }

  const [pair] = cookie.split(";");
  const [, value] = pair?.split("=") ?? [];

  if (!value) {
    throw new Error("Expected session cookie value");
  }

  return value;
}

class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, IdentityUser>();

  async create(input: CreateIdentityUserInput): Promise<IdentityUser> {
    const user: IdentityUser = {
      id: input.id,
      username: input.username,
      passwordHash: input.passwordHash,
      name: input.name,
      status: "ACTIVE",
      locale: input.locale,
      themeMode: input.themeMode,
    };
    this.users.set(user.id, user);
    return user;
  }

  async findById(id: string): Promise<IdentityUser | undefined> {
    return this.users.get(id);
  }

  async findByUsername(username: string): Promise<IdentityUser | undefined> {
    return this.getByUsername(username);
  }

  getByUsername(username: string): IdentityUser | undefined {
    return [...this.users.values()].find((user) => user.username === username);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.get(userId);

    if (user) {
      user.passwordHash = passwordHash;
    }
  }

  async updatePreferences(
    userId: string,
    input: UpdateUserPreferencesInput,
  ): Promise<PublicIdentityUser> {
    const user = this.users.get(userId);

    if (!user) {
      throw new Error(`Missing test user ${userId}`);
    }

    user.locale = input.locale;
    user.themeMode = input.themeMode;
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }
}

class InMemorySessionRepository implements SessionRepository {
  readonly records: IdentitySession[] = [];

  constructor(private readonly users: InMemoryUserRepository) {}

  async create(input: CreateIdentitySessionInput): Promise<IdentitySession> {
    const session: IdentitySession = {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      lastAccessedAt: new Date(),
    };
    this.records.push(session);
    return session;
  }

  async findValidByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<IdentitySessionWithUser | undefined> {
    const session = this.records.find(
      (record) =>
        record.tokenHash === tokenHash &&
        !record.revokedAt &&
        record.expiresAt > now,
    );
    const user = session
      ? await this.users.findById(session.userId)
      : undefined;

    return session && user && user.status === "ACTIVE"
      ? {
          session,
          user,
        }
      : undefined;
  }

  async revokeById(
    sessionId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<void> {
    const session = this.records.find((record) => record.id === sessionId);

    if (session && !session.revokedAt) {
      session.revokedAt = revokedAt;
      session.revocationReason = reason;
    }
  }

  async revokeActiveByUserId(
    userId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<void> {
    for (const session of this.records) {
      if (
        session.userId === userId &&
        !session.revokedAt &&
        session.expiresAt > revokedAt
      ) {
        session.revokedAt = revokedAt;
        session.revocationReason = reason;
      }
    }
  }

  async touch(sessionId: string, lastAccessedAt: Date): Promise<void> {
    const session = this.records.find((record) => record.id === sessionId);

    if (session) {
      session.lastAccessedAt = lastAccessedAt;
    }
  }
}
