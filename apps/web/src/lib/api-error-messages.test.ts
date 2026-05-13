import type { ApiErrorCode } from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import enMessages from "../../messages/en-US.json";
import zhMessages from "../../messages/zh-CN.json";
import { ApiClientError } from "./api-client";
import { getApiErrorMessageKey } from "./api-error-messages";

const m3ErrorCodes = [
  "WORKFLOW_ACTION_NOT_AVAILABLE",
  "WORKFLOW_ACTION_STATE_CONFLICT",
  "WORKFLOW_ACTION_PERMISSION_DENIED",
  "WORKFLOW_ACTION_FORM_INVALID",
  "WORKFLOW_ACTION_COMMENT_REQUIRED",
  "WORKFLOW_VERSION_INVALID",
  "SPACE_MEMBER_INVALID",
] satisfies ApiErrorCode[];

describe("api error messages", () => {
  it("maps M3 workflow/action errors to localized message keys", () => {
    for (const code of m3ErrorCodes) {
      const key = getApiErrorMessageKey(
        new ApiClientError(
          {
            code,
            message: code,
            requestId: "req_m3",
          },
          new Response(null, { status: 400 }),
        ),
      );

      expect(key).toBe(`errors.api.${code}`);
      expect(zhMessages.errors.api[code]).toBeTruthy();
      expect(enMessages.errors.api[code]).toBeTruthy();
    }
  });
});
