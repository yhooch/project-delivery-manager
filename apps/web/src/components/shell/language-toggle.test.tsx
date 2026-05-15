import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.hoisted(() => vi.fn());
const persistPreferencesMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("../../i18n/routing", () => ({
  usePathname: () => "/work-items",
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => ({
    session: { user: { id: "USR_01" } },
    persistPreferences: persistPreferencesMock,
  }),
}));

import { LanguageToggle } from "./language-toggle";

afterEach(() => {
  cleanup();
  replaceMock.mockReset();
  persistPreferencesMock.mockReset();
});

describe("LanguageToggle", () => {
  it("renders language names from i18n keys", async () => {
    render(<LanguageToggle />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "common.language.label" }),
    );

    expect(
      await screen.findByText("common.language.zh-CN.label"),
    ).toBeInTheDocument();
    expect(screen.getByText("common.language.en-US.label")).toBeInTheDocument();
    expect(screen.queryByText("中文")).not.toBeInTheDocument();
    expect(screen.queryByText("English")).not.toBeInTheDocument();
  });
});
