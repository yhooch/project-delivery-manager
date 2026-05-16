import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}));
vi.mock("../../i18n/routing", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const { loginMock, registerMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  registerMock: vi.fn(),
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => ({
    login: loginMock,
    register: registerMock,
  }),
}));

import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

beforeEach(() => {
  loginMock.mockReset();
  registerMock.mockReset();
  replaceMock.mockReset();
  loginMock.mockResolvedValue(undefined);
  registerMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("auth form components", () => {
  it("submits login values and returns to the app shell", async () => {
    render(<LoginForm />);

    fireEvent.change(
      screen.getByLabelText("forms.auth.fields.username.label"),
      {
        target: { value: "demo_user" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("forms.auth.fields.password.label"),
      {
        target: { value: "password-123" },
      },
    );
    fireEvent.click(screen.getByTestId("login-submit"));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({
        username: "demo_user",
        password: "password-123",
      }),
    );
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("validates register confirmation before submitting", async () => {
    render(<RegisterForm />);

    fireEvent.change(
      screen.getByLabelText("forms.auth.fields.username.label"),
      {
        target: { value: "demo_user" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("forms.auth.fields.password.label"),
      {
        target: { value: "password-123" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("forms.auth.fields.confirmPassword.label"),
      {
        target: { value: "password-456" },
      },
    );
    fireEvent.click(screen.getByTestId("register-submit"));

    await waitFor(() =>
      expect(
        screen.getByText("forms.auth.fields.confirmPassword.error"),
      ).toBeInTheDocument(),
    );
    expect(registerMock).not.toHaveBeenCalled();
  });
});
