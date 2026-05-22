import { performance } from "node:perf_hooks";

import { Inject, Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  getHttpAccessLogEnabled,
  getSlowHttpLogEnabled,
  getSlowHttpMs,
  type ObservabilityConfigReader,
} from "./observability.config";
import {
  runWithRequestLogContext,
  updateRequestLogContext,
} from "./request-log-context";
import {
  type StructuredLogEntry,
  type StructuredLogPayload,
  writeStructuredLog,
} from "./structured-log";
import {
  firstHeaderValue,
  getRequestId,
  type RequestWithContext,
} from "../http/request-context";

type ObservableRequest = RequestWithContext & {
  baseUrl?: string;
  method?: string;
  originalUrl?: string;
  path?: string;
  route?: {
    path?: RegExp | string | Array<RegExp | string>;
  };
  url?: string;
};

type ObservableResponse = {
  destroyed?: boolean;
  on(event: "close" | "finish", listener: () => void): void;
  statusCode?: number;
  writableEnded?: boolean;
};

type HttpLogInput = {
  durationMs: number;
  ip?: string;
  kind: "http" | "sse";
  method: string;
  organizationId?: string;
  path: string;
  queryKeys: string[];
  requestId: string;
  result: "aborted" | "completed";
  routePath?: string;
  spaceId?: string;
  statusCode: number;
  userAgent?: string;
  userId?: string;
};

@Injectable()
export class HttpObservabilityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(HttpObservabilityMiddleware.name);

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService,
  ) {}

  use(
    request: ObservableRequest,
    response: ObservableResponse,
    next: () => void,
  ): void {
    const startedAt = performance.now();
    const path = getRequestPath(request);
    const directIds = extractDirectContextIds(path);

    runWithRequestLogContext(
      {
        method: getRequestMethod(request),
        organizationId: directIds.organizationId,
        path,
        requestId: getRequestId(request),
        spaceId: directIds.spaceId,
      },
      () => {
        let logged = false;
        const logRequest = (event: "close" | "finish") => {
          if (logged) {
            return;
          }
          logged = true;

          const durationMs = Math.round(performance.now() - startedAt);
          const routePath = getRoutePath(request);
          const result =
            event === "finish" || response.writableEnded === true
              ? "completed"
              : "aborted";

          updateRequestLogContext({
            organizationId: request.session?.organizationId ??
              directIds.organizationId,
            routePath,
            spaceId: directIds.spaceId,
            userId: request.currentUser?.id ?? request.session?.userId,
          });

          for (const entry of buildHttpLogEntries(
            {
              durationMs,
              ip: getRequestIp(request),
              kind: isSsePath(path) ? "sse" : "http",
              method: getRequestMethod(request),
              organizationId: request.session?.organizationId ??
                directIds.organizationId,
              path,
              queryKeys: getQueryKeys(request),
              requestId: getRequestId(request),
              result,
              routePath,
              spaceId: directIds.spaceId,
              statusCode: response.statusCode ?? 0,
              userAgent: firstHeaderValue(request.headers?.["user-agent"]),
              userId: request.currentUser?.id ?? request.session?.userId,
            },
            this.config,
          )) {
            writeStructuredLog(this.logger, entry);
          }
        };

        response.on("finish", () => logRequest("finish"));
        response.on("close", () => logRequest("close"));
        next();
      },
    );
  }
}

export function buildHttpLogEntries(
  input: HttpLogInput,
  config: ObservabilityConfigReader,
): StructuredLogEntry[] {
  const entries: StructuredLogEntry[] = [];

  if (getHttpAccessLogEnabled(config)) {
    entries.push({
      level: input.kind === "sse" && input.result === "aborted"
        ? "warn"
        : "log",
      payload: buildBaseHttpPayload(
        input.kind === "sse" ? "sse_connection" : "http_access",
        input,
      ),
    });
  }

  if (
    input.kind === "http" &&
    getSlowHttpLogEnabled(config) &&
    input.durationMs >= getSlowHttpMs(config)
  ) {
    entries.push({
      level: "warn",
      payload: buildBaseHttpPayload("slow_http", input),
    });
  }

  return entries;
}

export function extractDirectContextIds(path: string): {
  organizationId?: string;
  spaceId?: string;
} {
  return {
    organizationId: extractPathSegmentValue(path, "organizations"),
    spaceId: extractPathSegmentValue(path, "spaces"),
  };
}

function buildBaseHttpPayload(
  event: "http_access" | "slow_http" | "sse_connection",
  input: HttpLogInput,
): StructuredLogPayload {
  return {
    durationMs: input.durationMs,
    event,
    ip: input.ip,
    method: input.method,
    organizationId: input.organizationId,
    path: input.path,
    queryKeys: input.queryKeys.length > 0 ? input.queryKeys : undefined,
    requestId: input.requestId,
    result: input.result,
    routePath: input.routePath,
    spaceId: input.spaceId,
    statusCode: input.statusCode,
    userAgent: input.userAgent,
    userId: input.userId,
  };
}

function getRequestPath(request: ObservableRequest): string {
  const source = request.originalUrl ?? request.url ?? request.path ?? "/";
  const [path] = source.split("?");

  return path && path.length > 0 ? path : "/";
}

function getRequestMethod(request: ObservableRequest): string {
  return request.method?.toUpperCase() ?? "UNKNOWN";
}

function getRoutePath(request: ObservableRequest): string | undefined {
  const routePath = request.route?.path;

  if (Array.isArray(routePath)) {
    return routePath.map(String).join("|");
  }

  if (routePath instanceof RegExp) {
    return routePath.toString();
  }

  if (typeof routePath !== "string" || routePath.length === 0) {
    return undefined;
  }

  return request.baseUrl ? `${request.baseUrl}${routePath}` : routePath;
}

function getQueryKeys(request: ObservableRequest): string[] {
  const source = request.originalUrl ?? request.url ?? "";
  const query = source.split("?")[1];

  if (!query) {
    return [];
  }

  return Array.from(new Set(new URLSearchParams(query).keys())).sort();
}

function getRequestIp(request: ObservableRequest): string | undefined {
  return request.ip ?? request.socket?.remoteAddress;
}

function isSsePath(path: string): boolean {
  return path.endsWith("/realtime/events");
}

function extractPathSegmentValue(
  path: string,
  segment: string,
): string | undefined {
  const parts = path.split("/").filter(Boolean);
  const index = parts.indexOf(segment);

  if (index < 0 || index + 1 >= parts.length) {
    return undefined;
  }

  return decodeSegment(parts[index + 1]);
}

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
