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

export function clearIncompatibleTraceSelection<T extends VersionedTraceOption>(
  options: T[],
  selectedOptionId: string,
  versionId: string,
): string {
  if (!selectedOptionId) {
    return "";
  }

  const selectedOption = options.find(
    (option) => option.id === selectedOptionId,
  );

  return isTraceOptionCompatibleWithVersion(selectedOption, versionId)
    ? selectedOptionId
    : "";
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
  labels?: TraceVersionCascadeConfirmLabels;
  suffix: string;
};

export type TraceVersionCascadeConfirmLabels = {
  affectedIds: string;
  bugs: string;
  intakeItems: string;
  noVersion: string;
  relatedBugs: string;
  requestId: string;
  scopeTitle: string;
  serverMessage: string;
  target: string;
  versionChange: string;
  workItems: string;
};

const DEFAULT_CASCADE_CONFIRM_LABELS: TraceVersionCascadeConfirmLabels = {
  affectedIds: "IDs",
  bugs: "Bugs",
  intakeItems: "Intake items",
  noVersion: "No version",
  relatedBugs: "Related bugs",
  requestId: "Request ID",
  scopeTitle: "Affected scope",
  serverMessage: "Server message",
  target: "Target",
  versionChange: "Version change",
  workItems: "Tasks",
};

export function getTraceVersionCascadeConfirmLabels(
  t: (key: string) => string,
): TraceVersionCascadeConfirmLabels {
  return {
    affectedIds: t("traceVersionCascadeConfirm.affectedIds"),
    bugs: t("traceVersionCascadeConfirm.bugs"),
    intakeItems: t("traceVersionCascadeConfirm.intakeItems"),
    noVersion: t("traceVersionCascadeConfirm.noVersion"),
    relatedBugs: t("traceVersionCascadeConfirm.relatedBugs"),
    requestId: t("traceVersionCascadeConfirm.requestId"),
    scopeTitle: t("traceVersionCascadeConfirm.scopeTitle"),
    serverMessage: t("traceVersionCascadeConfirm.serverMessage"),
    target: t("traceVersionCascadeConfirm.target"),
    versionChange: t("traceVersionCascadeConfirm.versionChange"),
    workItems: t("traceVersionCascadeConfirm.workItems"),
  };
}

export function traceVersionCascadeConfirmMessage(
  copy: TraceVersionCascadeConfirmCopy,
  error?: unknown,
): string {
  const scope = formatTraceVersionCascadeScope(
    error,
    copy.labels ?? DEFAULT_CASCADE_CONFIRM_LABELS,
  );

  return [copy.body, scope, copy.suffix].filter(Boolean).join("\n\n");
}

function formatTraceVersionCascadeScope(
  error: unknown,
  labels: TraceVersionCascadeConfirmLabels,
): string {
  if (!(error instanceof ApiClientError)) {
    return "";
  }

  const details = toRecord(error.error.details);
  const lines: string[] = [];

  if (details) {
    const targetType = readString(details.targetType);
    const targetId = readString(details.targetId);

    if (targetType || targetId) {
      lines.push(
        `- ${labels.target}: ${[targetType, targetId].filter(Boolean).join(" ")}`,
      );
    }

    if ("fromVersionId" in details || "toVersionId" in details) {
      lines.push(
        `- ${labels.versionChange}: ${formatVersionId(
          readNullableString(details.fromVersionId),
          labels,
        )} -> ${formatVersionId(
          readNullableString(details.toVersionId),
          labels,
        )}`,
      );
    }

    const impact = toRecord(details.impact);
    if (impact) {
      lines.push(
        ...[
          formatImpactLine({
            count: readNumber(impact.intakeItemCount),
            ids: readStringArray(impact.intakeItemIds),
            label: labels.intakeItems,
            labels,
          }),
          formatImpactLine({
            count: readNumber(impact.workItemCount),
            ids: readStringArray(impact.workItemIds),
            label: labels.workItems,
            labels,
          }),
          formatImpactLine({
            count: readNumber(impact.bugCount),
            ids: readStringArray(impact.bugIds),
            label: labels.bugs,
            labels,
          }),
          formatImpactLine({
            count: readNumber(impact.relatedBugCount),
            ids: readStringArray(impact.relatedBugIds),
            label: labels.relatedBugs,
            labels,
          }),
        ].filter((line): line is string => Boolean(line)),
      );
    }
  }

  if (lines.length === 0) {
    lines.push(`- ${labels.serverMessage}: ${error.error.message}`);
    lines.push(`- ${labels.requestId}: ${error.error.requestId}`);
  }

  return `${labels.scopeTitle}\n${lines.join("\n")}`;
}

function formatImpactLine({
  count,
  ids,
  label,
  labels,
}: {
  count: number | undefined;
  ids: string[];
  label: string;
  labels: TraceVersionCascadeConfirmLabels;
}) {
  if (count === undefined && ids.length === 0) {
    return null;
  }

  const countText = count ?? ids.length;
  const idsText =
    ids.length > 0 ? ` (${labels.affectedIds}: ${ids.join(", ")})` : "";

  return `- ${label}: ${countText}${idsText}`;
}

function formatVersionId(
  versionId: string | null | undefined,
  labels: TraceVersionCascadeConfirmLabels,
) {
  return versionId || labels.noVersion;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return readString(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
