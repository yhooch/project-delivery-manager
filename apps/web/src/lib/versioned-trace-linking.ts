import { ApiClientError } from "./api-client";

export const TRACE_VERSION_CONFLICT = "TRACE_VERSION_CONFLICT";
export const TRACE_VERSION_CHANGE_REQUIRES_CASCADE =
  "TRACE_VERSION_CHANGE_REQUIRES_CASCADE";
export const TRACE_CASCADE_CONFLICT = "TRACE_CASCADE_CONFLICT";

const TRACE_VERSION_ERROR_CODES = new Set([
  TRACE_VERSION_CONFLICT,
  TRACE_VERSION_CHANGE_REQUIRES_CASCADE,
  TRACE_CASCADE_CONFLICT,
]);

export type VersionedTraceOption = {
  id?: string;
  versionId?: string | null;
};

export function filterTraceOptionsByVersion<T extends VersionedTraceOption>(
  options: T[],
  versionId: string,
  currentOptionId = "",
): T[] {
  if (!versionId) {
    return options;
  }

  return options.filter(
    (option) =>
      option.id === currentOptionId ||
      !option.versionId ||
      option.versionId === versionId,
  );
}

export function isTraceOptionCompatibleWithVersion(
  option: VersionedTraceOption | undefined,
  versionId: string,
): boolean {
  if (!option?.versionId) {
    return true;
  }

  return Boolean(versionId) && option.versionId === versionId;
}

export function inheritVersionFromTraceOption(
  option: VersionedTraceOption | undefined,
  currentVersionId: string,
): string {
  return option?.versionId || currentVersionId;
}

export function getTraceVersionErrorCode(error: unknown): string | null {
  if (
    error instanceof ApiClientError &&
    TRACE_VERSION_ERROR_CODES.has(error.error.code)
  ) {
    return error.error.code;
  }

  return null;
}

export function isTraceVersionError(error: unknown): boolean {
  return getTraceVersionErrorCode(error) !== null;
}

export function isTraceVersionCascadeRequiredError(error: unknown): boolean {
  return (
    getTraceVersionErrorCode(error) === TRACE_VERSION_CHANGE_REQUIRES_CASCADE
  );
}

export type TraceVersionCascadeConfirmCopy = {
  body: string;
  suffix: string;
};

const defaultCascadeConfirmCopy: TraceVersionCascadeConfirmCopy = {
  body: "版本变更会影响已关联的下游对象，请确认后继续。",
  suffix: "确认后将同步更新已关联对象的版本，是否继续？",
};

export function traceVersionCascadeConfirmMessage(
  copy: TraceVersionCascadeConfirmCopy = defaultCascadeConfirmCopy,
): string {
  return `${copy.body}\n\n${copy.suffix}`;
}
