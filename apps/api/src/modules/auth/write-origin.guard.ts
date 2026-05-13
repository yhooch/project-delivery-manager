import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ApiException } from "../../http/api-exception";
import {
  firstHeaderValue,
  type RequestWithContext,
} from "../../http/request-context";

@Injectable()
export class WriteOriginGuard implements CanActivate {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const sourceOrigin = getSourceOrigin(request);

    if (!sourceOrigin) {
      throwInvalidOrigin();
    }

    const allowedOrigins = new Set<string>([
      new URL(this.config.get<string>("WEB_APP_URL") ?? "http://localhost:3000")
        .origin,
      getRequestOrigin(request),
    ]);

    if (!allowedOrigins.has(sourceOrigin)) {
      throwInvalidOrigin();
    }

    return true;
  }
}

function getSourceOrigin(request: RequestWithContext): string | undefined {
  const origin = firstHeaderValue(request.headers?.origin);

  if (origin) {
    return safeOrigin(origin);
  }

  const referer = firstHeaderValue(request.headers?.referer);
  return referer ? safeOrigin(referer) : undefined;
}

function getRequestOrigin(request: RequestWithContext): string {
  const host = firstHeaderValue(request.headers?.["x-forwarded-host"]) ??
    firstHeaderValue(request.headers?.host) ??
    "localhost";
  const protocol = firstHeaderValue(request.headers?.["x-forwarded-proto"]) ??
    request.protocol ??
    "http";

  return `${protocol}://${host}`;
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function throwInvalidOrigin(): never {
  throw new ApiException(
    "FORBIDDEN",
    "Invalid request origin",
    HttpStatus.FORBIDDEN,
  );
}
