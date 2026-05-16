import { ApiErrorCodeSchema } from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import enMessages from "../../messages/en-US.json";
import zhMessages from "../../messages/zh-CN.json";
import { ApiClientError } from "./api-client";
import { getApiErrorMessageKey } from "./api-error-messages";

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
    expect(getApiErrorMessageKey(new Error("boom"))).toBe(
      "errors.api.UNKNOWN",
    );
    expect(zhMessages.errors.api.UNKNOWN).toBeTruthy();
    expect(enMessages.errors.api.UNKNOWN).toBeTruthy();
  });
});
