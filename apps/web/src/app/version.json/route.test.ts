import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const ENV_KEYS = [
  "WEB_VERSION",
  "WEB_COMMIT",
  "WEB_BUILD_TIME",
  "WEB_IMAGE_DIGEST",
  "WEB_CHANNEL",
] as const;

const originalEnv = new Map<string, string | undefined>();

for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("GET /version.json", () => {
  it("returns web runtime version proof as non-cacheable json", async () => {
    process.env["WEB_VERSION"] = "1.2.3";
    process.env["WEB_COMMIT"] = "def456";
    process.env["WEB_BUILD_TIME"] = "2026-05-21T11:00:00Z";
    process.env["WEB_IMAGE_DIGEST"] = "sha256:web";
    process.env["WEB_CHANNEL"] = "stable";

    const response = GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      service: "web",
      status: "ok",
      version: "1.2.3",
      commit: "def456",
      buildTime: "2026-05-21T11:00:00Z",
      imageDigest: "sha256:web",
      channel: "stable",
    });
  });
});
