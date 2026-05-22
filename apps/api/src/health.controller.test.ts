import { describe, expect, it } from "vitest";

import { getApiHealth } from "./health.controller";

describe("getApiHealth", () => {
  it("returns stable defaults when version proof env is missing", () => {
    expect(getApiHealth({})).toEqual({
      service: "api",
      status: "ok",
      version: "unknown",
      commit: "unknown",
      buildTime: "unknown",
      imageDigest: "unknown",
      channel: "development",
    });
  });

  it("returns only allowlisted version proof fields from env", () => {
    const result = getApiHealth({
      API_VERSION: "1.2.3",
      API_COMMIT: "abc123",
      API_BUILD_TIME: "2026-05-21T10:00:00Z",
      API_IMAGE_DIGEST: "sha256:api",
      API_CHANNEL: "stable",
      DATABASE_URL: "postgresql://user:password@example.local/db",
    });

    expect(result).toEqual({
      service: "api",
      status: "ok",
      version: "1.2.3",
      commit: "abc123",
      buildTime: "2026-05-21T10:00:00Z",
      imageDigest: "sha256:api",
      channel: "stable",
    });
    expect(result).not.toHaveProperty("DATABASE_URL");
  });
});
