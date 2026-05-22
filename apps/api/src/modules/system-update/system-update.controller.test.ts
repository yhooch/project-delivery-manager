import { type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiResponseInterceptor } from "../../http/api-response.interceptor";
import { GlobalExceptionFilter } from "../../http/global-exception.filter";
import { configureApp } from "../../main";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import {
  SYSTEM_UPDATE_CLIENT,
  type SystemUpdateClient,
} from "./system-update.client";
import { SystemUpdateController } from "./system-update.controller";
import { SystemUpdateOperatorGuard } from "./system-update-operator.guard";
import { SystemUpdateOperatorService } from "./system-update-operator.service";
import { SystemUpdateService } from "./system-update.service";

const now = "2026-05-22T00:00:00.000Z";

describe("SystemUpdateController", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("requires platform operator access before returning status", async () => {
    const subject = await createApp({
      config: {
        SYSTEM_OPERATOR_USER_IDS: "operator-1",
      },
      userId: "user-1",
    });
    app = subject.app;

    const response = await request(app.getHttpServer())
      .get("/api/v1/system/update/status")
      .expect(403);

    expect(response.body).toMatchObject({
      code: "UPDATE_ACCESS_DENIED",
    });
    expect(subject.client.getStatus).not.toHaveBeenCalled();
  });

  it("returns PLATFORM_OPERATOR_REQUIRED when no allowlist is configured", async () => {
    const subject = await createApp({
      config: {},
      userId: "user-1",
    });
    app = subject.app;

    const response = await request(app.getHttpServer())
      .get("/api/v1/system/update/status")
      .expect(403);

    expect(response.body).toMatchObject({
      code: "PLATFORM_OPERATOR_REQUIRED",
    });
  });

  it("proxies validated read and write requests to the updater client", async () => {
    const subject = await createApp({
      config: {
        SYSTEM_OPERATOR_USER_IDS: "operator-1",
      },
      userId: "operator-1",
    });
    app = subject.app;

    await request(app.getHttpServer())
      .get("/api/v1/system/update/status")
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({ phase: "idle" });
      });

    await request(app.getHttpServer())
      .post("/api/v1/system/update/check")
      .set("origin", "http://localhost:3000")
      .send({ channel: "stable" })
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({ status: "current" });
      });

    expect(subject.client.check).toHaveBeenCalledWith({
      channel: "stable",
      force: false,
    });
  });
});

async function createApp(options: {
  config: Record<string, string | undefined>;
  userId: string;
}) {
  const client = createFakeClient();
  const moduleRef = await Test.createTestingModule({
    controllers: [SystemUpdateController],
    providers: [
      RequireSessionGuard,
      WriteOriginGuard,
      SystemUpdateOperatorGuard,
      SystemUpdateOperatorService,
      SystemUpdateService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            options.config[key] ??
            ({
              NODE_ENV: "test",
              WEB_APP_URL: "http://localhost:3000",
            } satisfies Record<string, string>)[key],
        },
      },
      {
        provide: SYSTEM_UPDATE_CLIENT,
        useValue: client,
      },
      {
        provide: APP_FILTER,
        useClass: GlobalExceptionFilter,
      },
      {
        provide: APP_INTERCEPTOR,
        useClass: ApiResponseInterceptor,
      },
    ],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication());

  app.use(
    (
      request_: { session?: unknown; currentUser?: unknown },
      _response: unknown,
      next: () => void,
    ) => {
      request_.session = {
        expiresAt: new Date("2026-05-22T00:00:00.000Z"),
        sessionId: "session-1",
        tokenHash: "token-hash",
        userId: options.userId,
      };
      request_.currentUser = {
        id: options.userId,
        username: "operator",
        name: "Operator",
        status: "ACTIVE",
        preferences: {
          locale: "zh-CN",
          themeMode: "LIGHT",
        },
      };
      next();
    },
  );
  await app.init();

  return {
    app,
    client,
  };
}

function createFakeClient(): SystemUpdateClient {
  return {
    check: vi.fn(async () => ({
      status: "current" as const,
      channel: "stable",
      currentVersion: "1.0.0",
      checkedAt: now,
    })),
    createJob: vi.fn(),
    getJob: vi.fn(),
    getStatus: vi.fn(async () => ({
      phase: "idle" as const,
      updatedAt: now,
    })),
    rollbackJob: vi.fn(),
  };
}
