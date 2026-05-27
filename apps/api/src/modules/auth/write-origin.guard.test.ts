import { type ExecutionContext } from "@nestjs/common";
import { type ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { WriteOriginGuard } from "./write-origin.guard";

describe("WriteOriginGuard", () => {
  it("accepts the primary web app origin", () => {
    const guard = createGuard({
      NODE_ENV: "production",
      WEB_APP_URL: "http://public.example:34511",
    });

    expect(
      guard.canActivate(createContext("http://public.example:34511")),
    ).toBe(true);
  });

  it("accepts same-host origins without an allowlist entry", () => {
    const guard = createGuard({
      NODE_ENV: "production",
      WEB_APP_URL: "http://public.example:34511",
    });

    expect(
      guard.canActivate(
        createContext("http://192.168.1.10:34511", {
          host: "192.168.1.10:34511",
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        createContext("http://10.0.0.8:34511", {
          host: "10.0.0.8:34511",
        }),
      ),
    ).toBe(true);
  });

  it("normalizes default ports when comparing origin and host", () => {
    const guard = createGuard({
      NODE_ENV: "production",
      WEB_APP_URL: "http://public.example",
    });

    expect(
      guard.canActivate(
        createContext("http://private.example", {
          host: "private.example:80",
        }),
      ),
    ).toBe(true);
  });

  it("rejects different-host origins in production", () => {
    const guard = createGuard({
      NODE_ENV: "production",
      WEB_APP_URL: "http://public.example:34511",
    });

    expect(() =>
      guard.canActivate(
        createContext("http://evil.example", {
          host: "public.example:34511",
        }),
      ),
    ).toThrow("Invalid request origin");
  });

  it("ignores spoofed forwarded host values", () => {
    const guard = createGuard({
      NODE_ENV: "production",
      WEB_APP_URL: "http://public.example:34511",
    });

    expect(() =>
      guard.canActivate(
        createContext("http://private.example:34511", {
          host: "public.example:34511",
          "x-forwarded-host": "private.example:34511",
        }),
      ),
    ).toThrow("Invalid request origin");
  });

  it("still rejects missing origins", () => {
    const guard = createGuard({
      NODE_ENV: "production",
      WEB_APP_URL: "http://public.example:34511",
    });

    expect(() =>
      guard.canActivate(
        createContext(undefined, {
          host: "public.example:34511",
        }),
      ),
    ).toThrow("Invalid request origin");
  });

  it("rejects untrusted configured-origin bypass attempts", () => {
    const guard = createGuard({
      NODE_ENV: "production",
      WEB_APP_URL: "http://public.example:34511",
    });

    expect(() =>
      guard.canActivate(
        createContext("http://public.example.evil.test", {
          host: "public.example:34511",
        }),
      ),
    ).toThrow("Invalid request origin");
  });

  it("accepts referer when origin is absent", () => {
    const guard = createGuard({
      NODE_ENV: "production",
      WEB_APP_URL: "http://public.example:34511",
    });

    expect(
      guard.canActivate(
        createContext(undefined, {
          host: "private.example:34511",
          referer: "http://private.example:34511/app",
        }),
      ),
    ).toBe(true);
  });
});

function createGuard(config: Record<string, unknown>): WriteOriginGuard {
  return new WriteOriginGuard({
    get: (key: string) => config[key],
  } as ConfigService);
}

function createContext(
  origin: string | undefined,
  headers: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          ...headers,
          ...(origin ? { origin } : {}),
        },
      }),
    }),
  } as unknown as ExecutionContext;
}
