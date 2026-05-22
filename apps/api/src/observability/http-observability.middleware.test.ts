import { describe, expect, it } from "vitest";

import {
  buildHttpLogEntries,
  extractDirectContextIds,
} from "./http-observability.middleware";
import type { ObservabilityConfigReader } from "./observability.config";

describe("HTTP observability logging", () => {
  it("emits access and slow logs for slow HTTP requests", () => {
    const entries = buildHttpLogEntries(
      {
        durationMs: 1_200,
        kind: "http",
        method: "GET",
        path: "/api/v1/spaces/space_1/requirements",
        queryKeys: ["page", "status"],
        requestId: "req_1",
        result: "completed",
        statusCode: 200,
      },
      config({
        HTTP_ACCESS_LOG_ENABLED: true,
        SLOW_HTTP_LOG_ENABLED: true,
        SLOW_HTTP_MS: 1_000,
      }),
    );

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.payload.event)).toEqual([
      "http_access",
      "slow_http",
    ]);
    expect(entries[1]?.level).toBe("warn");
    expect(entries[0]?.payload.queryKeys).toEqual(["page", "status"]);
  });

  it("does not emit slow_http for SSE connections", () => {
    const entries = buildHttpLogEntries(
      {
        durationMs: 60_000,
        kind: "sse",
        method: "GET",
        path: "/api/v1/realtime/events",
        queryKeys: [],
        requestId: "req_sse",
        result: "completed",
        statusCode: 200,
      },
      config({
        HTTP_ACCESS_LOG_ENABLED: true,
        SLOW_HTTP_LOG_ENABLED: true,
        SLOW_HTTP_MS: 1_000,
      }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload.event).toBe("sse_connection");
  });

  it("extracts direct organization and space ids from API paths", () => {
    expect(
      extractDirectContextIds(
        "/api/v1/organizations/org_1/spaces/space_1/members",
      ),
    ).toEqual({
      organizationId: "org_1",
      spaceId: "space_1",
    });
  });
});

function config(values: Record<string, unknown>): ObservabilityConfigReader {
  return {
    get: <T = unknown>(key: string) => values[key] as T | undefined,
  };
}
