import type { ApiErrorCode } from "@project-delivery/shared";

import { ApiClientError } from "./api-client";

export type ApiErrorMessageKey = `errors.api.${ApiErrorCode | "UNKNOWN"}`;

export function getApiErrorMessageKey(error: unknown): ApiErrorMessageKey {
  if (error instanceof ApiClientError) {
    return `errors.api.${error.error.code}`;
  }

  return "errors.api.UNKNOWN";
}

export function isUnauthorizedApiError(error: unknown): boolean {
  return error instanceof ApiClientError && error.error.code === "UNAUTHORIZED";
}
