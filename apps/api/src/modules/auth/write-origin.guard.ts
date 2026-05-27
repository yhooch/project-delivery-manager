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

    if (
      !isConfiguredAppOrigin(this.config, sourceOrigin) &&
      !matchesRequestHost(request, sourceOrigin)
    ) {
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

function isConfiguredAppOrigin(
  config: ConfigService,
  sourceOrigin: string,
): boolean {
  const configuredOrigin = safeOrigin(
    config.get<string>("WEB_APP_URL") ?? "http://localhost:3000",
  );

  if (sourceOrigin === configuredOrigin) {
    return true;
  }

  if ((config.get<string>("NODE_ENV") ?? "development") !== "production") {
    return (
      sourceOrigin === "http://localhost:3000" ||
      sourceOrigin === "http://127.0.0.1:3000"
    );
  }

  return false;
}

function matchesRequestHost(
  request: RequestWithContext,
  sourceOrigin: string,
): boolean {
  const requestHost = firstHeaderValue(request.headers?.host);

  if (!requestHost) {
    return false;
  }

  try {
    const sourceUrl = new URL(sourceOrigin);
    const requestUrl = new URL(`${sourceUrl.protocol}//${requestHost.trim()}`);

    return (
      sourceUrl.host.toLowerCase() === requestUrl.host.toLowerCase()
    );
  } catch {
    return false;
  }
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
