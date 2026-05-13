import {
  firstHeaderValue,
  type RequestWithContext,
} from "../../http/request-context";
import type { RequestMetadata } from "./auth-session.types";

export function getRequestMetadata(request: RequestWithContext): RequestMetadata {
  return {
    ip: getRequestIp(request),
    userAgent: firstHeaderValue(request.headers?.["user-agent"]),
  };
}

export function getRequestIp(request: RequestWithContext): string | undefined {
  const forwardedFor = firstHeaderValue(request.headers?.["x-forwarded-for"]);

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  return request.ip ?? request.socket?.remoteAddress;
}
