import type { Logger } from "@nestjs/common";

import {
  getQueryLogIncludeParams,
  getQueryLogMode,
  getQueryLogSqlMaxLength,
  getSlowQueryLogEnabled,
  getSlowQueryMs,
  type ObservabilityConfigReader,
} from "./observability.config";
import { getRequestLogContext } from "./request-log-context";
import {
  type StructuredLogEntry,
  type StructuredLogPayload,
  writeStructuredLog,
} from "./structured-log";

export type PrismaQueryLogEvent = {
  duration: number;
  params: string;
  query: string;
  target: string;
  timestamp: Date;
};

export function logPrismaQueryEvent(
  event: PrismaQueryLogEvent,
  config: ObservabilityConfigReader,
  logger: Pick<Logger, "error" | "log" | "warn">,
): void {
  const entry = buildPrismaQueryLogEntry(event, config);

  if (!entry) {
    return;
  }

  writeStructuredLog(logger, entry);
}

export function buildPrismaQueryLogEntry(
  event: PrismaQueryLogEvent,
  config: ObservabilityConfigReader,
): StructuredLogEntry | undefined {
  const mode = getQueryLogMode(config);

  if (mode === "off") {
    return undefined;
  }

  const slowQueryMs = getSlowQueryMs(config);
  const isSlow = event.duration >= slowQueryMs;

  if (mode === "slow" && (!getSlowQueryLogEnabled(config) || !isSlow)) {
    return undefined;
  }

  return {
    level: isSlow ? "warn" : "log",
    payload: buildPrismaQueryPayload(isSlow ? "slow_query" : "query_log", {
      config,
      event,
      slowQueryMs,
    }),
  };
}

export function shouldEnablePrismaQueryEvents(
  config: ObservabilityConfigReader,
): boolean {
  const mode = getQueryLogMode(config);

  return mode === "all" || (mode === "slow" && getSlowQueryLogEnabled(config));
}

function buildPrismaQueryPayload(
  eventName: "query_log" | "slow_query",
  input: {
    config: ObservabilityConfigReader;
    event: PrismaQueryLogEvent;
    slowQueryMs: number;
  },
): StructuredLogPayload {
  const context = getRequestLogContext();
  const includeParams = getQueryLogIncludeParams(input.config);
  const maxLength = getQueryLogSqlMaxLength(input.config);

  return {
    durationMs: input.event.duration,
    event: eventName,
    method: context?.method,
    organizationId: context?.organizationId,
    params: includeParams
      ? truncateLogValue(input.event.params, maxLength)
      : undefined,
    path: context?.path,
    query: truncateLogValue(normalizeSql(input.event.query), maxLength),
    requestId: context?.requestId ?? "unknown",
    routePath: context?.routePath,
    slowQueryMs: input.slowQueryMs,
    spaceId: context?.spaceId,
    target: input.event.target,
    timestamp: input.event.timestamp.toISOString(),
    userId: context?.userId,
  };
}

function normalizeSql(query: string): string {
  return query.replace(/\s+/gu, " ").trim();
}

function truncateLogValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}
