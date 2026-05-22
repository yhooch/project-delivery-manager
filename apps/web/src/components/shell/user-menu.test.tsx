import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logoutMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("../../i18n/routing", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => ({
    logout: logoutMock,
    session: {
      user: {
        name: "Ada Lovelace",
        username: "ada",
      },
    },
  }),
}));

vi.mock("./change-password-dialog", () => ({
  ChangePasswordDialog: () => null,
}));

import { UserMenu } from "./user-menu";

beforeEach(() => {
  logoutMock.mockReset();
});

describe("UserMenu", () => {
  it("links to personal settings from the avatar menu", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);

    await user.click(
      screen.getByRole("button", { name: "shell.user.openMenu" }),
    );

    const link = await screen.findByRole("menuitem", {
      name: /shell.user.personalSettings/u,
    });

    expect(link).toHaveAttribute("href", "/personal-settings");
  });
});
