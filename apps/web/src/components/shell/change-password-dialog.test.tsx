import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const { changePasswordMock } = vi.hoisted(() => ({
  changePasswordMock: vi.fn(),
}));

vi.mock("../../lib/session-service", () => ({
  changePassword: changePasswordMock,
}));

import { ApiClientError } from "../../lib/api-client";
import { ChangePasswordDialog } from "./change-password-dialog";

beforeEach(() => {
  changePasswordMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChangePasswordDialog", () => {
  it("submits the change password request with the entered values", async () => {
    changePasswordMock.mockResolvedValueOnce({});
    const onOpenChange = vi.fn();
    render(
      <ChangePasswordDialog open={true} onOpenChange={onOpenChange} />,
    );

    fireEvent.input(screen.getByTestId("change-password-old"), {
      target: { value: "old-password-1" },
    });
    fireEvent.input(screen.getByTestId("change-password-new"), {
      target: { value: "new-password-2" },
    });
    fireEvent.input(screen.getByTestId("change-password-confirm"), {
      target: { value: "new-password-2" },
    });

    fireEvent.click(screen.getByTestId("change-password-submit"));

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith({
        oldPassword: "old-password-1",
        newPassword: "new-password-2",
        confirmPassword: "new-password-2",
      });
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows the invalidCredentials error when the API rejects with INVALID_CREDENTIALS", async () => {
    changePasswordMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "INVALID_CREDENTIALS",
          message: "Invalid current password",
          requestId: "req_test",
        },
        new Response(null, { status: 401 }),
      ),
    );
    const onOpenChange = vi.fn();
    render(
      <ChangePasswordDialog open={true} onOpenChange={onOpenChange} />,
    );

    fireEvent.input(screen.getByTestId("change-password-old"), {
      target: { value: "wrong-password-1" },
    });
    fireEvent.input(screen.getByTestId("change-password-new"), {
      target: { value: "new-password-2" },
    });
    fireEvent.input(screen.getByTestId("change-password-confirm"), {
      target: { value: "new-password-2" },
    });

    fireEvent.click(screen.getByTestId("change-password-submit"));

    await waitFor(() => {
      expect(
        screen.getByTestId("change-password-error"),
      ).toHaveTextContent("shell.changePassword.errors.invalidCredentials");
    });
    expect(screen.getByTestId("change-password-error")).toHaveTextContent(
      "Invalid current password",
    );
    expect(screen.getByTestId("change-password-error")).toHaveTextContent(
      "errors.apiDetails.requestId: req_test",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("blocks submit when the new password matches the old password", async () => {
    const onOpenChange = vi.fn();
    render(
      <ChangePasswordDialog open={true} onOpenChange={onOpenChange} />,
    );

    fireEvent.input(screen.getByTestId("change-password-old"), {
      target: { value: "same-password-1" },
    });
    fireEvent.input(screen.getByTestId("change-password-new"), {
      target: { value: "same-password-1" },
    });
    fireEvent.input(screen.getByTestId("change-password-confirm"), {
      target: { value: "same-password-1" },
    });

    fireEvent.click(screen.getByTestId("change-password-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("change-password-new-error")).toHaveTextContent(
        "shell.changePassword.errors.sameAsOld",
      );
    });
    expect(changePasswordMock).not.toHaveBeenCalled();
  });
});
