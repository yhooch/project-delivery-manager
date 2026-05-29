// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFocusedListItem } from "./use-focused-list-item";

function FocusedListFixture({
  focusedId = "comment-1",
  resetKey = "document-1",
  revision = 0,
}: {
  focusedId?: string;
  resetKey?: string;
  revision?: number;
}) {
  const { highlightedId, registerItem } = useFocusedListItem<HTMLDivElement>({
    focusedId,
    resetKey,
  });

  return (
    <div data-revision={revision}>
      <div
        data-highlighted={highlightedId === "comment-1" ? "true" : "false"}
        data-testid="comment-1"
        ref={registerItem("comment-1")}
      />
    </div>
  );
}

describe("useFocusedListItem", () => {
  const scrollIntoViewMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("aligns the focused item below sticky chrome and does not refocus on rerender", async () => {
    const { rerender } = render(<FocusedListFixture />);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ block: "start" });
    expect(screen.getByTestId("comment-1").style.scrollMarginTop).toBe("7rem");

    rerender(<FocusedListFixture revision={1} />);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.runOnlyPendingTimers();
    });
    rerender(<FocusedListFixture revision={2} />);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it("refocuses when the reset key changes", async () => {
    const { rerender } = render(<FocusedListFixture />);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    rerender(<FocusedListFixture resetKey="document-2" />);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });
});
