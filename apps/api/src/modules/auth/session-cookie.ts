import { ConfigService } from "@nestjs/config";

import type { SessionCookie } from "./auth-session.types";

export type CookieResponse = {
  clearCookie(name: string, options: SessionCookieOptions): void;
  cookie(name: string, value: string, options: SessionCookieOptions): void;
};

export type SessionCookieOptions = {
  expires?: Date;
  httpOnly: true;
  maxAge?: number;
  path: string;
  sameSite: "lax";
  secure: boolean;
};

export function setSessionCookie(
  response: CookieResponse,
  config: ConfigService,
  cookie: SessionCookie,
): void {
  response.cookie(cookie.name, cookie.token, {
    expires: cookie.expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureCookie(config),
  });
}

export function clearSessionCookie(
  response: CookieResponse,
  config: ConfigService,
  name: string,
): void {
  response.clearCookie(name, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureCookie(config),
  });
}

function isSecureCookie(config: ConfigService): boolean {
  return config.get<string>("NODE_ENV") === "production";
}
