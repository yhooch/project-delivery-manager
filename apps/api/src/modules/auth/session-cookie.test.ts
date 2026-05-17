import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import {
  clearSessionCookie,
  setSessionCookie,
  type CookieResponse,
  type SessionCookieOptions,
} from "./session-cookie";

type RecordedCookie = {
  name: string;
  options: SessionCookieOptions;
  value?: string;
};

function createConfig(values: Record<string, unknown>): ConfigService {
  return {
    get<T>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  } as ConfigService;
}

function createResponse(): CookieResponse & {
  cleared: RecordedCookie[];
  cookies: RecordedCookie[];
} {
  return {
    cleared: [],
    cookies: [],
    clearCookie(name: string, options: SessionCookieOptions) {
      this.cleared.push({ name, options });
    },
    cookie(name: string, value: string, options: SessionCookieOptions) {
      this.cookies.push({ name, options, value });
    },
  };
}

describe("session-cookie", () => {
  it("uses secure cookies by default in production", () => {
    const response = createResponse();

    setSessionCookie(response, createConfig({ NODE_ENV: "production" }), {
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      name: "pdm_session",
      token: "session-token",
    });

    expect(response.cookies[0]?.options.secure).toBe(true);
  });

  it("allows disabling secure cookies for HTTP compose deployments", () => {
    const response = createResponse();
    const config = createConfig({
      NODE_ENV: "production",
      SESSION_COOKIE_SECURE: false,
    });

    setSessionCookie(response, config, {
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      name: "pdm_session",
      token: "session-token",
    });
    clearSessionCookie(response, config, "pdm_session");

    expect(response.cookies[0]?.options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
    expect(response.cleared[0]?.options.secure).toBe(false);
  });
});
