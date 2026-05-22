import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { OAuthTokenService } from "./oauth-token.service";

describe("OAuthTokenService", () => {
  it("creates opaque tokens and stores only sha256 hashes", () => {
    const service = new OAuthTokenService();
    const token = service.createAccessToken();
    const hash = service.hashToken(token);

    expect(token).toMatch(/^mcp_at_/u);
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("verifies S256 PKCE challenges", () => {
    const service = new OAuthTokenService();
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");

    expect(service.verifyCodeChallenge(verifier, challenge)).toBe(true);
    expect(service.verifyCodeChallenge(`${verifier}!`, challenge)).toBe(false);
  });
});
