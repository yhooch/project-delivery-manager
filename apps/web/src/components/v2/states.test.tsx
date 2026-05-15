import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

import { ErrorState, LoadingState } from "./states";

afterEach(() => {
  cleanup();
});

describe("states", () => {
  it("uses i18n keys for built-in loading and error copy", () => {
    render(
      <>
        <LoadingState />
        <ErrorState onRetry={() => undefined} />
      </>,
    );

    expect(screen.getByText("common.states.loading")).toBeInTheDocument();
    expect(screen.getByText("common.states.errorTitle")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "common.states.retry" }),
    ).toBeInTheDocument();
  });
});
