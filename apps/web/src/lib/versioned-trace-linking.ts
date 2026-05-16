import { ApiClientError } from "./api-client";

export const TRACE_VERSION_CHANGE_REQUIRES_CASCADE =
  "TRACE_VERSION_CHANGE_REQUIRES_CASCADE";

export type VersionedTraceOption = {
  versionId?: string | null;
};

export function filterTraceOptionsByVersion<T extends VersionedTraceOption>(
  options: T[],
  versionId: string,
): T[] {
  if (!versionId) {
    return options;
  }

  return options.filter(
    (option) => !option.versionId || option.versionId === versionId,
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

export function isTraceVersionCascadeRequiredError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.error.code === TRACE_VERSION_CHANGE_REQUIRES_CASCADE
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
