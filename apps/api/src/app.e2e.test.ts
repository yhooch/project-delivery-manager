import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "./app.module";
import { configureApp } from "./main";

describe("API infrastructure", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??=
      "postgresql://postgres:postgres@localhost:5432/project_delivery_manager";
    process.env["NODE_ENV"] = "test";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("wraps GET /health in ApiResponse with requestId", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health")
      .set("x-request-id", "test-request-id")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("test-request-id");
    expect(response.body).toEqual({
      data: {
        service: "api",
        status: "ok",
      },
      requestId: "test-request-id",
    });
  });

  it("generates requestId when the client does not provide one", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe(response.body.requestId);
    expect(response.body.requestId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
  });

  it("rejects protected auth session route without session context", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/auth/session")
      .set("x-request-id", "auth-request-id")
      .expect(401);

    expect(response.headers["x-request-id"]).toBe("auth-request-id");
    expect(response.body).toEqual({
      code: "UNAUTHORIZED",
      message: "Authentication is required",
      requestId: "auth-request-id",
    });
  });
});
