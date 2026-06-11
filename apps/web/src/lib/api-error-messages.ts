import {
  ApiErrorCodeSchema,
  type ApiErrorCode,
} from "@project-delivery/shared";

import { ApiClientError } from "./api-client";

export type ApiErrorMessageKey = `errors.api.${ApiErrorCode | "UNKNOWN"}`;

const KNOWN_API_ERROR_CODES = new Set<string>(ApiErrorCodeSchema.options);
const MAX_SERVER_MESSAGE_LENGTH = 500;
const MAX_DETAIL_STRING_LENGTH = 300;
const MAX_ISSUES = 8;
const MAX_PATH_SEGMENTS = 8;
const MAX_STRING_ARRAY_ITEMS = 6;
const MAX_SUMMARY_ITEMS = 12;

const SAFE_DETAIL_KEYS = [
  "field",
  "reason",
  "referenceCount",
  "requestId",
  "targetType",
  "targetId",
  "target",
  "clientVersion",
  "fromVersionId",
  "toVersionId",
  "source",
  "allowedSources",
  "organizationName",
  "spaceName",
] as const;

export type ApiErrorDetailSummaryKey = (typeof SAFE_DETAIL_KEYS)[number];

export type ApiErrorDetailSummaryValue = string | number | boolean | string[];

export type ApiErrorDetailSummary = {
  key: ApiErrorDetailSummaryKey;
  value: ApiErrorDetailSummaryValue;
};

export type ApiErrorIssueSummary = {
  code?: string;
  message?: string;
  path?: string;
};

export type ApiErrorDisplayDetails = {
  field?: string;
  issues: ApiErrorIssueSummary[];
  reason?: string;
  referenceCount?: number;
  requestId?: string;
  summary: ApiErrorDetailSummary[];
};

export type ApiErrorMessageDetails = {
  details: ApiErrorDisplayDetails;
  messageKey: ApiErrorMessageKey;
  requestId?: string;
  serverMessage?: string;
};

export function getApiErrorMessageKey(error: unknown): ApiErrorMessageKey {
  const apiError = readApiErrorPayload(error);

  if (apiError && isKnownApiErrorCode(apiError.code)) {
    return `errors.api.${apiError.code}`;
  }

  return "errors.api.UNKNOWN";
}

export function getApiErrorMessageDetails(
  error: unknown,
): ApiErrorMessageDetails {
  const messageKey = getApiErrorMessageKey(error);
  const apiError = readApiErrorPayload(error);

  if (!apiError) {
    return {
      details: createEmptyDisplayDetails(),
      messageKey,
    };
  }

  const result: ApiErrorMessageDetails = {
    details: extractDisplayDetails(apiError.details),
    messageKey,
  };
  const serverMessage = normalizeString(
    apiError.message,
    MAX_SERVER_MESSAGE_LENGTH,
  );
  const requestId = normalizeString(
    apiError.requestId,
    MAX_DETAIL_STRING_LENGTH,
  );

  if (serverMessage) {
    result.serverMessage = serverMessage;
  }

  if (requestId) {
    result.requestId = requestId;
  }

  return result;
}

export function isUnauthorizedApiError(error: unknown): boolean {
  return error instanceof ApiClientError && error.error.code === "UNAUTHORIZED";
}

function isKnownApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && KNOWN_API_ERROR_CODES.has(value);
}

function readApiErrorPayload(error: unknown):
  | {
      code: string;
      details?: unknown;
      message: string;
      requestId: string;
    }
  | undefined {
  if (error instanceof ApiClientError) {
    return error.error;
  }

  const record = readRecord(error);
  const apiError = readRecord(record?.apiError);

  if (!apiError) {
    return undefined;
  }

  if (
    typeof apiError.code !== "string" ||
    typeof apiError.message !== "string" ||
    typeof apiError.requestId !== "string"
  ) {
    return undefined;
  }

  return {
    code: apiError.code,
    details: apiError.details,
    message: apiError.message,
    requestId: apiError.requestId,
  };
}

function extractDisplayDetails(details: unknown): ApiErrorDisplayDetails {
  const record = readRecord(details);

  if (!record) {
    return createEmptyDisplayDetails();
  }

  const result: ApiErrorDisplayDetails = {
    issues: extractIssueSummaries(record.issues),
    summary: extractDetailSummary(record),
  };
  const field = normalizeString(record.field, MAX_DETAIL_STRING_LENGTH);
  const reason = normalizeString(record.reason, MAX_DETAIL_STRING_LENGTH);
  const requestId = normalizeString(record.requestId, MAX_DETAIL_STRING_LENGTH);
  const referenceCount = normalizeNumber(record.referenceCount);

  if (field) {
    result.field = field;
  }

  if (reason) {
    result.reason = reason;
  }

  if (requestId) {
    result.requestId = requestId;
  }

  if (referenceCount !== undefined) {
    result.referenceCount = referenceCount;
  }

  return result;
}

function createEmptyDisplayDetails(): ApiErrorDisplayDetails {
  return {
    issues: [],
    summary: [],
  };
}

function extractIssueSummaries(value: unknown): ApiErrorIssueSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_ISSUES)
    .map(readIssueSummary)
    .filter((issue): issue is ApiErrorIssueSummary => Boolean(issue));
}

function readIssueSummary(issue: unknown): ApiErrorIssueSummary | undefined {
  const record = readRecord(issue);

  if (!record) {
    return undefined;
  }

  const result: ApiErrorIssueSummary = {};
  const code = normalizeString(record.code, MAX_DETAIL_STRING_LENGTH);
  const message = normalizeString(record.message, MAX_DETAIL_STRING_LENGTH);
  const path = normalizeIssuePath(record.path);

  if (code) {
    result.code = code;
  }

  if (message) {
    result.message = message;
  }

  if (path) {
    result.path = path;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeIssuePath(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const parts = value
      .slice(0, MAX_PATH_SEGMENTS)
      .map((part) => {
        if (typeof part === "string" || typeof part === "number") {
          return String(part);
        }

        return undefined;
      })
      .filter((part): part is string => Boolean(part));

    if (parts.length === 0) {
      return undefined;
    }

    return truncateString(
      `${parts.join(".")}${value.length > MAX_PATH_SEGMENTS ? "..." : ""}`,
      MAX_DETAIL_STRING_LENGTH,
    );
  }

  if (typeof value === "string" || typeof value === "number") {
    return normalizeString(String(value), MAX_DETAIL_STRING_LENGTH);
  }

  return undefined;
}

function extractDetailSummary(
  record: Record<string, unknown>,
): ApiErrorDetailSummary[] {
  const summary: ApiErrorDetailSummary[] = [];

  for (const key of SAFE_DETAIL_KEYS) {
    if (summary.length >= MAX_SUMMARY_ITEMS) {
      break;
    }

    const value = readSafeDetailValue(record[key]);

    if (value !== undefined) {
      summary.push({ key, value });
    }
  }

  return summary;
}

function readSafeDetailValue(
  value: unknown,
): ApiErrorDetailSummaryValue | undefined {
  const text = normalizeString(value, MAX_DETAIL_STRING_LENGTH);

  if (text) {
    return text;
  }

  const numberValue = normalizeNumber(value);

  if (numberValue !== undefined) {
    return numberValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    const items = value
      .slice(0, MAX_STRING_ARRAY_ITEMS)
      .map((item) => truncateString(item.trim(), MAX_DETAIL_STRING_LENGTH))
      .filter(Boolean);

    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

function normalizeString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? truncateString(trimmed, maxLength) : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
