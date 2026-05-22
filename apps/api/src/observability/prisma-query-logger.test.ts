import { describe, expect, it } from "vitest";

import type { ObservabilityConfigReader } from "./observability.config";
import {
  buildPrismaQueryLogEntry,
  shouldEnablePrismaQueryEvents,
} from "./prisma-query-logger";

describe("Prisma query logging", () => {
  it("emits slow_query when duration crosses the slow threshold", () => {
    const entry = buildPrismaQueryLogEntry(
      {
        duration: 350,
        params: "[\"secret\"]",
        query: "SELECT   *\nFROM users WHERE id = $1",
        target: "quaint::connector::metrics",
        timestamp: new Date("2026-05-22T00:00:00.000Z"),
      },
      config({
        QUERY_LOG_MODE: "slow",
        QUERY_LOG_INCLUDE_PARAMS: false,
        QUERY_LOG_SQL_MAX_LENGTH: 2_000,
        SLOW_QUERY_LOG_ENABLED: true,
        SLOW_QUERY_MS: 300,
      }),
    );

    expect(entry?.level).toBe("warn");
    expect(entry?.payload).toMatchObject({
      durationMs: 350,
      event: "slow_query",
      params: undefined,
      query: "SELECT * FROM users WHERE id = $1",
      requestId: "unknown",
    });
  });

  it("includes query params by default", () => {
    const entry = buildPrismaQueryLogEntry(
      {
        duration: 350,
        params: "[\"value\"]",
        query: "SELECT * FROM users WHERE username = $1",
        target: "quaint::connector::metrics",
        timestamp: new Date("2026-05-22T00:00:00.000Z"),
      },
      config({
        QUERY_LOG_MODE: "slow",
        SLOW_QUERY_LOG_ENABLED: true,
        SLOW_QUERY_MS: 300,
      }),
    );

    expect(entry?.payload.params).toBe("[\"value\"]");
  });

  it("suppresses fast queries in slow mode", () => {
    const entry = buildPrismaQueryLogEntry(
      {
        duration: 20,
        params: "[]",
        query: "SELECT 1",
        target: "test",
        timestamp: new Date("2026-05-22T00:00:00.000Z"),
      },
      config({
        QUERY_LOG_MODE: "slow",
        SLOW_QUERY_LOG_ENABLED: true,
        SLOW_QUERY_MS: 300,
      }),
    );

    expect(entry).toBeUndefined();
  });

  it("emits query_log for fast queries in all mode", () => {
    const entry = buildPrismaQueryLogEntry(
      {
        duration: 20,
        params: "[]",
        query: "SELECT 1",
        target: "test",
        timestamp: new Date("2026-05-22T00:00:00.000Z"),
      },
      config({
        QUERY_LOG_MODE: "all",
        SLOW_QUERY_MS: 300,
      }),
    );

    expect(entry?.level).toBe("log");
    expect(entry?.payload.event).toBe("query_log");
  });

  it("does not enable Prisma query events when slow query logging is disabled in slow mode", () => {
    expect(
      shouldEnablePrismaQueryEvents(
        config({
          QUERY_LOG_MODE: "slow",
          SLOW_QUERY_LOG_ENABLED: false,
        }),
      ),
    ).toBe(false);
  });
});

function config(values: Record<string, unknown>): ObservabilityConfigReader {
  return {
    get: <T = unknown>(key: string) => values[key] as T | undefined,
  };
}
