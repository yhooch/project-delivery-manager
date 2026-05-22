import { describe, expect, it } from "vitest";

import { buildRuntimeVersionProof } from "./runtime-version";

describe("buildRuntimeVersionProof", () => {
  it("uses stable defaults when runtime proof env is missing", () => {
    expect(buildRuntimeVersionProof("api", {})).toEqual({
      service: "api",
      status: "ok",
      version: "unknown",
      commit: "unknown",
      buildTime: "unknown",
      imageDigest: "unknown",
      channel: "development",
    });
  });

  it("prefers service-specific env over common env", () => {
    expect(
      buildRuntimeVersionProof("web", {
        APP_VERSION: "1.0.0",
        GIT_COMMIT: "common-commit",
        BUILD_TIME: "2026-05-21T00:00:00Z",
        IMAGE_DIGEST: "sha256:common",
        RELEASE_CHANNEL: "canary",
        WEB_VERSION: "1.2.3",
        WEB_COMMIT: "web-commit",
        WEB_BUILD_TIME: "2026-05-22T00:00:00Z",
        WEB_IMAGE_DIGEST: "sha256:web",
        WEB_CHANNEL: "stable",
      }),
    ).toEqual({
      service: "web",
      status: "ok",
      version: "1.2.3",
      commit: "web-commit",
      buildTime: "2026-05-22T00:00:00Z",
      imageDigest: "sha256:web",
      channel: "stable",
    });
  });
});
