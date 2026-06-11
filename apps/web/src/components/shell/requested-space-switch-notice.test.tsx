import { act } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestedSpaceSwitchNotice } from "./requested-space-switch-notice";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: { spaceName?: string }) =>
      [namespace, key, values?.spaceName].filter(Boolean).join(" "),
}));

describe("RequestedSpaceSwitchNotice", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders as a top success banner and dismisses after 2 seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <RequestedSpaceSwitchNotice
        notice={{ id: "notice-1", spaceName: "Space B" }}
        onDismiss={onDismiss}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveClass("fixed", "inset-x-0", "top-0", "z-40");
    expect(notice).toHaveClass("bg-emerald-500", "text-white");
    expect(notice).toHaveTextContent("Space B");

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
