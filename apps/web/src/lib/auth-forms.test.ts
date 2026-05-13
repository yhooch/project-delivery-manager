import { describe, expect, it } from "vitest";

import zhMessages from "../../messages/zh-CN.json";
import { ApiClientError } from "./api-client";
import { getApiErrorMessageKey } from "./api-error-messages";
import { validateRegisterForm } from "./auth-forms";

describe("auth forms", () => {
  it("validates register values with the shared schema and password match rule", () => {
    expect(
      validateRegisterForm({
        confirmPassword: "password-123",
        password: "password-123",
        username: "ab",
      }).success,
    ).toBe(false);

    expect(
      validateRegisterForm({
        confirmPassword: "password-456",
        password: "password-123",
        username: "valid_user",
      }).success,
    ).toBe(false);

    expect(
      validateRegisterForm({
        confirmPassword: "password-123",
        password: "password-123",
        username: "valid_user",
      }).success,
    ).toBe(true);
  });

  it("maps login API failures to localized error keys", () => {
    const key = getApiErrorMessageKey(
      new ApiClientError(
        {
          code: "INVALID_CREDENTIALS",
          message: "Invalid username or password",
          requestId: "req_login",
        },
        new Response(null, { status: 401 }),
      ),
    );

    expect(key).toBe("errors.api.INVALID_CREDENTIALS");
    expect(zhMessages.errors.api.INVALID_CREDENTIALS).toBe("用户名或密码不正确。");
  });
});
