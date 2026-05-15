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

    const allowedOrigins = getAllowedOrigins(this.config);

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

function getAllowedOrigins(config: ConfigService): Set<string> {
  const origins = new Set<string>();
  const configuredOrigin = safeOrigin(
    config.get<string>("WEB_APP_URL") ?? "http://localhost:3000",
  );

  if (configuredOrigin) {
    origins.add(configuredOrigin);
  }

  if ((config.get<string>("NODE_ENV") ?? "development") !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
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
