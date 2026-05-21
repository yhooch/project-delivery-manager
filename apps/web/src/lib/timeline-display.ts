import type {
  TimelineEvent,
  TimelineEventType,
} from "@project-delivery/shared";

type TimelineEventLabelTranslator = (key: TimelineEventType) => string;
export type TimelineMessageTranslator = ((key: string) => string) & {
  has?: (key: string) => boolean;
};

export type TimelineChangeDisplay = {
  after?: string;
  before?: string;
  field: string;
};

export type TimelineEventDisplay = {
  actionLabel: string;
  actor: {
    avatar?: string;
    initial: string;
    name: string;
  };
  changes: TimelineChangeDisplay[];
  detail?: string;
  href?: string | null;
  secondary?: string;
  summary: string;
  targetTitle?: string;
  time: string;
};

type TimelineEventDisplayOptions = {
  href?: string | null;
  translateMessage?: TimelineMessageTranslator;
  translateEventType: TimelineEventLabelTranslator;
  unknownActorLabel?: string;
};

type TimelineChangeValueSide = "after" | "before";

const CHANGE_FIELD_MESSAGE_PREFIX = "common.timeline.change.field";
const CHANGE_VALUE_MESSAGE_PREFIX = "common.timeline.change.value";

const REFERENCE_CHANGE_FIELDS = new Set([
  "assigneeId",
  "currentStateId",
  "intakeItemId",
  "ownerId",
  "relatedTaskId",
  "reporterId",
  "requirementId",
  "versionId",
]);

const ENUM_VALUE_NAMESPACE_BY_FIELD: Record<string, string> = {
  priority: "priority",
  severity: "severity",
  status: "status",
  statusCategory: "statusCategory",
};

export function getTimelineEventLabel(
  eventType: TimelineEventType,
  translate: TimelineEventLabelTranslator,
): string {
  try {
    return translate(eventType);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      throw error;
    }
    return eventType;
  }
}

export function formatTimelineEvent(
  event: TimelineEvent,
  options: TimelineEventDisplayOptions,
): TimelineEventDisplay {
  const actorName = event.actor.name || options.unknownActorLabel || "";
  const actionName = readString(event.metadata, "actionName");
  const actionCode = readString(event.metadata, "actionCode");
  const eventLabel = getTimelineEventLabel(
    event.eventType,
    options.translateEventType,
  );
  const actionLabel = resolveActionLabel({
    actionCode,
    actionName,
    eventLabel,
    translateMessage: options.translateMessage,
  });
  const targetTitle = normalizeString(event.target.title);
  const commentPreview = readString(event.metadata, "commentPreview");
  const fileName = readString(event.metadata, "fileName");
  const attachmentMeta = formatAttachmentMeta(event.metadata);
  const formValues = formatFormValues(
    readRecord(event.metadata?.formValues),
    options.translateMessage,
  );
  const summary = selectSummary({
    actionLabel,
    commentPreview,
    event,
    eventLabel,
    fileName,
    targetTitle,
  });
  const detailCandidates = selectDetailCandidates({
    attachmentMeta,
    event,
    eventDetail: event.detail,
    formValues,
    summary,
  });

  return {
    actionLabel,
    actor: {
      avatar: event.actor.avatar,
      initial: initialOf(actorName),
      name: actorName,
    },
    changes: getChangedFields(
      event.before,
      event.after,
      event.metadata,
      options.translateMessage,
    ),
    detail: detailCandidates[0],
    href: options.href,
    secondary: detailCandidates.slice(1).join(" / ") || undefined,
    summary,
    targetTitle,
    time: event.createdAt,
  };
}

function resolveActionLabel({
  actionCode,
  actionName,
  eventLabel,
  translateMessage,
}: {
  actionCode?: string;
  actionName?: string;
  eventLabel: string;
  translateMessage?: TimelineMessageTranslator;
}): string {
  if (actionCode) {
    const translated = translateOptional(
      translateMessage,
      `common.workflowDefaults.actions.${actionCode}`,
    );
    if (translated) {
      return translated;
    }
  }

  return actionName ?? actionCode ?? eventLabel;
}

function selectSummary({
  actionLabel,
  commentPreview,
  event,
  eventLabel,
  fileName,
  targetTitle,
}: {
  actionLabel: string;
  commentPreview?: string;
  event: TimelineEvent;
  eventLabel: string;
  fileName?: string;
  targetTitle?: string;
}): string {
  if (event.eventType === "COMMENTED") {
    return commentPreview ?? targetTitle ?? "";
  }

  if (event.eventType === "ATTACHMENT_ADDED") {
    return fileName ?? targetTitle ?? "";
  }

  if (isActionLikeEvent(event.eventType)) {
    return (
      firstNonDuplicate(
        [readStateName(event.metadata), targetTitle],
        [actionLabel, eventLabel],
      ) ?? ""
    );
  }

  return targetTitle ?? "";
}

function selectDetailCandidates({
  attachmentMeta,
  event,
  eventDetail,
  formValues,
  summary,
}: {
  attachmentMeta?: string;
  event: TimelineEvent;
  eventDetail?: string;
  formValues?: string;
  summary: string;
}): string[] {
  if (event.eventType === "ATTACHMENT_ADDED") {
    return uniqueStrings([eventDetail, attachmentMeta]).filter(
      (value) => !isSameText(value, summary),
    );
  }

  if (event.eventType === "COMMENTED") {
    return uniqueStrings([eventDetail]).filter(
      (value) => !isSameText(value, summary),
    );
  }

  return uniqueStrings([eventDetail, formValues]).filter(
    (value) => !isSameText(value, summary),
  );
}

function isActionLikeEvent(eventType: TimelineEventType): boolean {
  return (
    eventType === "ACTION_EXECUTED" ||
    eventType === "CLOSED" ||
    eventType === "REOPENED" ||
    eventType === "ASSIGNEE_CHANGED"
  );
}

function firstNonDuplicate(
  candidates: Array<string | undefined>,
  blocked: string[],
): string | undefined {
  return candidates.find(
    (candidate) =>
      candidate &&
      !blocked.some((blockedValue) => isSameText(candidate, blockedValue)),
  );
}

function readStateName(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  return (
    readString(metadata, "toStateName") ??
    readString(metadata, "toState") ??
    readString(metadata, "afterStateName") ??
    readString(metadata, "assigneeName")
  );
}

function formatAttachmentMeta(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const mimeType = readString(metadata, "mimeType");
  const size = formatFileSize(metadata?.size);
  return uniqueStrings([mimeType, size]).join(" / ") || undefined;
}

function formatFileSize(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = normalizeString(value);
    const parsed = normalized ? Number(normalized) : Number.NaN;
    return Number.isFinite(parsed) ? formatFileSize(parsed) : normalized;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const formatted = unitIndex === 0 ? String(size) : size.toFixed(1);
  return `${formatted.replace(/\.0$/u, "")} ${units[unitIndex]}`;
}

function getChangedFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  translateMessage: TimelineMessageTranslator | undefined,
): TimelineChangeDisplay[] {
  const changedFieldNames = new Set(readChangedFieldNames(metadata));
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  for (const key of changedFieldNames) {
    keys.add(key);
  }

  return Array.from(keys)
    .filter(
      (key) =>
        changedFieldNames.has(key) ||
        !isEqualValue(before?.[key], after?.[key]),
    )
    .map((key) => ({
      after: formatChangeValue(
        key,
        after?.[key],
        "after",
        metadata,
        translateMessage,
      ),
      before: formatChangeValue(
        key,
        before?.[key],
        "before",
        metadata,
        translateMessage,
      ),
      field: formatChangeField(key, translateMessage),
    }));
}

function formatChangeField(
  field: string,
  translateMessage: TimelineMessageTranslator | undefined,
): string {
  return (
    translateOptional(
      translateMessage,
      `${CHANGE_FIELD_MESSAGE_PREFIX}.${field}`,
    ) ??
    humanizeStableOption(field) ??
    field
  );
}

function formatChangeValue(
  field: string,
  value: unknown,
  side: TimelineChangeValueSide,
  metadata: Record<string, unknown> | undefined,
  translateMessage: TimelineMessageTranslator | undefined,
): string | undefined {
  const stateValue = formatStateChangeValue(
    field,
    side,
    metadata,
    translateMessage,
  );
  if (stateValue) {
    return stateValue;
  }

  if (isEmptyValue(value)) {
    return translateChangeValue(translateMessage, "empty");
  }

  const formatted = formatValue(value);
  if (!formatted) {
    return translateChangeValue(translateMessage, "empty");
  }

  if (isReferenceField(field)) {
    return translateChangeValue(translateMessage, "reference") ?? formatted;
  }

  if (typeof value === "boolean") {
    return (
      translateChangeValue(translateMessage, `boolean.${String(value)}`) ??
      formatted
    );
  }

  const enumNamespace = ENUM_VALUE_NAMESPACE_BY_FIELD[field];
  if (enumNamespace) {
    return (
      translateChangeValue(translateMessage, `${enumNamespace}.${formatted}`) ??
      humanizeStableOption(formatted) ??
      formatted
    );
  }

  return formatted;
}

function isReferenceField(field: string): boolean {
  return REFERENCE_CHANGE_FIELDS.has(field) || /Id$/u.test(field);
}

function formatStateChangeValue(
  field: string,
  side: TimelineChangeValueSide,
  metadata: Record<string, unknown> | undefined,
  translateMessage: TimelineMessageTranslator | undefined,
): string | undefined {
  if (field !== "currentStateId") {
    return undefined;
  }

  const stateName =
    side === "before"
      ? readString(metadata, "fromStateName")
      : readString(metadata, "toStateName");
  if (stateName) {
    return stateName;
  }

  const stateCode =
    side === "before"
      ? readString(metadata, "fromStateCode")
      : readString(metadata, "toStateCode");
  if (!stateCode) {
    return undefined;
  }

  return (
    translateOptional(
      translateMessage,
      `common.workflowDefaults.states.${stateCode}`,
    ) ??
    humanizeStableOption(stateCode) ??
    stateCode
  );
}

function translateChangeValue(
  translateMessage: TimelineMessageTranslator | undefined,
  key: string,
): string | undefined {
  return translateOptional(
    translateMessage,
    `${CHANGE_VALUE_MESSAGE_PREFIX}.${key}`,
  );
}

function readChangedFieldNames(
  metadata: Record<string, unknown> | undefined,
): string[] {
  const value = metadata?.changedFields;

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function formatFormValues(
  values: Record<string, unknown> | null,
  translateMessage: TimelineMessageTranslator | undefined,
): string | undefined {
  if (!values) {
    return undefined;
  }

  const pairs = Object.entries(values)
    .map(([key, value]) => {
      const formatted = formatFormValue(key, value, translateMessage);
      return formatted
        ? `${formatFormField(key, translateMessage)}: ${formatted}`
        : undefined;
    })
    .filter(Boolean)
    .slice(0, 4);

  return pairs.length > 0 ? pairs.join(" / ") : undefined;
}

function formatFormField(
  field: string,
  translateMessage: TimelineMessageTranslator | undefined,
): string {
  return (
    translateOptional(
      translateMessage,
      `common.workflowDefaults.fields.${field}`,
    ) ?? formatChangeField(field, translateMessage)
  );
}

function formatFormValue(
  field: string,
  value: unknown,
  translateMessage: TimelineMessageTranslator | undefined,
): string | undefined {
  if (isEmptyValue(value)) {
    return translateChangeValue(translateMessage, "empty");
  }

  const formatted = formatValue(value);
  if (!formatted) {
    return translateChangeValue(translateMessage, "empty");
  }

  if (isReferenceField(field)) {
    return translateChangeValue(translateMessage, "reference") ?? formatted;
  }

  if (typeof value === "boolean") {
    return (
      translateChangeValue(translateMessage, `boolean.${String(value)}`) ??
      formatted
    );
  }

  return (
    translateOptional(
      translateMessage,
      `common.workflowDefaults.fieldOptions.${field}.${formatted}`,
    ) ??
    translateOptional(
      translateMessage,
      `common.workflowDefaults.optionValues.${formatted}`,
    ) ??
    translateChangeValue(
      translateMessage,
      `${ENUM_VALUE_NAMESPACE_BY_FIELD[field] ?? field}.${formatted}`,
    ) ??
    humanizeEnumValue(formatted) ??
    formatted
  );
}

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return truncate(
      value
        .map((item) => formatValue(item))
        .filter(Boolean)
        .join(", "),
    );
  }

  if (typeof value === "object") {
    try {
      return truncate(JSON.stringify(value));
    } catch {
      return undefined;
    }
  }

  return truncate(String(value));
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isEqualValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSameText(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase(),
  );
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return normalizeString(record?.[key]);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

function initialOf(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

function truncate(value: string): string {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}

function translateOptional(
  translateMessage: TimelineMessageTranslator | undefined,
  key: string,
): string | undefined {
  if (!translateMessage) {
    return undefined;
  }

  if (translateMessage.has && !translateMessage.has(key)) {
    return undefined;
  }

  try {
    const translated = translateMessage(key);
    return translated === key ? undefined : translated;
  } catch {
    return undefined;
  }
}

function humanizeStableOption(option: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(option)) {
    return undefined;
  }

  const words = option
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[_\-\s]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return undefined;
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function humanizeEnumValue(value: string): string | undefined {
  return /^[A-Z0-9_]+$/u.test(value) ? humanizeStableOption(value) : undefined;
}
