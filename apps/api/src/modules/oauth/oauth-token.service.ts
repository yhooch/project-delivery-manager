import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { Injectable } from "@nestjs/common";

const PKCE_CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/u;

@Injectable()
export class OAuthTokenService {
  createAuthorizationCode(): string {
    return randomBytes(32).toString("base64url");
  }

  createAccessToken(): string {
    return `mcp_at_${randomBytes(32).toString("base64url")}`;
  }

  createRefreshToken(): string {
    return `mcp_rt_${randomBytes(48).toString("base64url")}`;
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
    if (!PKCE_CODE_VERIFIER_PATTERN.test(codeVerifier)) {
      return false;
    }

    const computed = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    return safeEqual(computed, codeChallenge);
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
