import {
  ApiErrorCodeSchema,
  type ApiErrorCode,
} from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import enMessages from "../../messages/en-US.json";
import zhMessages from "../../messages/zh-CN.json";
import { ApiClientError } from "./api-client";
import {
  getApiErrorMessageDetails,
  getApiErrorMessageKey,
} from "./api-error-messages";

describe("api error messages", () => {
  it("maps every shared API error code to localized message keys", () => {
    for (const code of ApiErrorCodeSchema.options) {
      const key = getApiErrorMessageKey(
        new ApiClientError(
          {
            code,
            message: code,
            requestId: `req_${code.toLowerCase()}`,
          },
          new Response(null, { status: 400 }),
        ),
      );

      expect(key).toBe(`errors.api.${code}`);
      expect(zhMessages.errors.api[code]).toBeTruthy();
      expect(enMessages.errors.api[code]).toBeTruthy();
    }
  });

  it("keeps a localized fallback for non-API errors", () => {
    expect(getApiErrorMessageKey(new Error("boom"))).toBe("errors.api.UNKNOWN");
    expect(zhMessages.errors.api.UNKNOWN).toBeTruthy();
    expect(enMessages.errors.api.UNKNOWN).toBeTruthy();
  });

  it("keeps server messages for API errors", () => {
    const message = "Workflow action form is missing required fields";
    const details = getApiErrorMessageDetails(
      createApiClientError({
        code: "WORKFLOW_ACTION_FORM_INVALID",
        message,
        requestId: "req_server_message",
      }),
    );

    expect(details).toMatchObject({
      messageKey: "errors.api.WORKFLOW_ACTION_FORM_INVALID",
      requestId: "req_server_message",
      serverMessage: message,
    });
  });

  it("keeps server messages for custom errors carrying standard API errors", () => {
    const details = getApiErrorMessageDetails({
      apiError: {
        code: "VALIDATION_ERROR",
        details: {
          issues: [
            {
              message: "Redirect URI is invalid",
              path: ["redirectUri"],
            },
          ],
        },
        message: "Authorization request is invalid",
        requestId: "req_oauth",
      },
    });

    expect(details).toMatchObject({
      messageKey: "errors.api.VALIDATION_ERROR",
      requestId: "req_oauth",
      serverMessage: "Authorization request is invalid",
    });
    expect(details.details.issues).toEqual([
      {
        message: "Redirect URI is invalid",
        path: "redirectUri",
      },
    ]);
  });


  it("formats zod-style issues without rendering unsafe fields", () => {
    const details = getApiErrorMessageDetails(
      createApiClientError({
        code: "VALIDATION_ERROR",
        details: {
          issues: [
            {
              code: "too_small",
              message: "Title is required",
              path: ["items", 0, "title"],
              received: {
                unsafe: true,
              },
            },
            {
              code: "invalid_type",
              message: "Expected string",
              path: ["ownerId"],
            },
          ],
        },
        message: "Validation failed",
        requestId: "req_zod_issues",
      }),
    );

    expect(details.details.issues).toEqual([
      {
        code: "too_small",
        message: "Title is required",
        path: "items.0.title",
      },
      {
        code: "invalid_type",
        message: "Expected string",
        path: "ownerId",
      },
    ]);
    expect(details.details.summary).toEqual([]);
  });

  it("extracts safe detail summaries for reason and request ids", () => {
    const details = getApiErrorMessageDetails(
      createApiClientError({
        code: "DOCUMENT_IMPORT_FAILED",
        details: {
          clientVersion: "6.8.2",
          field: "contentMarkdown",
          nested: {
            shouldNotRender: true,
          },
          reason: "DOCX conversion timed out",
          referenceCount: 2,
          requestId: "converter_req_1",
          target: ["organizationId", "code"],
        },
        message: "Document import failed",
        requestId: "req_import",
      }),
    );

    expect(details.requestId).toBe("req_import");
    expect(details.details).toMatchObject({
      field: "contentMarkdown",
      reason: "DOCX conversion timed out",
      referenceCount: 2,
      requestId: "converter_req_1",
    });
    expect(details.details.summary).toEqual([
      {
        key: "field",
        value: "contentMarkdown",
      },
      {
        key: "reason",
        value: "DOCX conversion timed out",
      },
      {
        key: "referenceCount",
        value: 2,
      },
      {
        key: "requestId",
        value: "converter_req_1",
      },
      {
        key: "target",
        value: ["organizationId", "code"],
      },
      {
        key: "clientVersion",
        value: "6.8.2",
      },
    ]);
  });

  it("falls back to UNKNOWN for API errors with unknown runtime codes", () => {
    const error = createApiClientError({
      code: "NEW_BACKEND_CODE" as ApiErrorCode,
      message: "The backend returned a new code",
      requestId: "req_unknown_code",
    });
    const details = getApiErrorMessageDetails(error);

    expect(getApiErrorMessageKey(error)).toBe("errors.api.UNKNOWN");
    expect(details).toMatchObject({
      messageKey: "errors.api.UNKNOWN",
      requestId: "req_unknown_code",
      serverMessage: "The backend returned a new code",
    });
  });
});

function createApiClientError(input: {
  code: ApiErrorCode;
  details?: unknown;
  message: string;
  requestId: string;
}): ApiClientError {
  return new ApiClientError(input, new Response(null, { status: 400 }));
}
