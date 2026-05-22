export type QueryLogMode = "all" | "off" | "slow";

export type ObservabilityConfigReader = {
  get<T = unknown>(key: string): T | undefined;
};

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSY_VALUES = new Set(["0", "false", "no", "off"]);
const QUERY_LOG_MODES = new Set<QueryLogMode>(["all", "off", "slow"]);

export function getHttpAccessLogEnabled(
  config: ObservabilityConfigReader,
): boolean {
  return getBooleanConfig(config, "HTTP_ACCESS_LOG_ENABLED", true);
}

export function getSlowHttpLogEnabled(
  config: ObservabilityConfigReader,
): boolean {
  return getBooleanConfig(config, "SLOW_HTTP_LOG_ENABLED", true);
}

export function getSlowHttpMs(config: ObservabilityConfigReader): number {
  return getNumberConfig(config, "SLOW_HTTP_MS", 1_000);
}

export function getSlowQueryLogEnabled(
  config: ObservabilityConfigReader,
): boolean {
  return getBooleanConfig(config, "SLOW_QUERY_LOG_ENABLED", true);
}

export function getSlowQueryMs(config: ObservabilityConfigReader): number {
  return getNumberConfig(config, "SLOW_QUERY_MS", 300);
}

export function getQueryLogMode(
  config: ObservabilityConfigReader,
): QueryLogMode {
  const value = config.get<unknown>("QUERY_LOG_MODE");

  if (typeof value !== "string") {
    return "slow";
  }

  const normalized = value.trim().toLowerCase();

  return QUERY_LOG_MODES.has(normalized as QueryLogMode)
    ? (normalized as QueryLogMode)
    : "slow";
}

export function getQueryLogIncludeParams(
  config: ObservabilityConfigReader,
): boolean {
  return getBooleanConfig(config, "QUERY_LOG_INCLUDE_PARAMS", true);
}

export function getQueryLogSqlMaxLength(
  config: ObservabilityConfigReader,
): number {
  return getNumberConfig(config, "QUERY_LOG_SQL_MAX_LENGTH", 2_000);
}

function getBooleanConfig(
  config: ObservabilityConfigReader,
  key: string,
  fallback: boolean,
): boolean {
  const value = config.get<unknown>(key);

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (TRUTHY_VALUES.has(normalized)) {
      return true;
    }
    if (FALSY_VALUES.has(normalized)) {
      return false;
    }
  }

  return fallback;
}

function getNumberConfig(
  config: ObservabilityConfigReader,
  key: string,
  fallback: number,
): number {
  const value = config.get<unknown>(key);
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
