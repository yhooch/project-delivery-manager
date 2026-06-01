import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { OAuthConfigService } from "./oauth-config.service";

describe("OAuthConfigService", () => {
  it("defaults MCP access tokens to 24 hours", () => {
    const service = new OAuthConfigService(new ConfigService({}));

    expect(service.getAccessTokenTtlSeconds()).toBe(60 * 60 * 24);
  });
});
