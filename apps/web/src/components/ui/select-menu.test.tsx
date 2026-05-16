import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SelectMenu } from "./select-menu";

afterEach(() => {
  cleanup();
});

describe("SelectMenu", () => {
  it("gives the visible trigger the forwarded accessible name", async () => {
    render(
      <>
        <span id="status-label">Status</span>
        <SelectMenu
          id="status"
          aria-labelledby="status-label"
          data-testid="status-select"
          value="todo"
          onChange={() => undefined}
        >
          <option value="todo">To do</option>
          <option value="done">Done</option>
        </SelectMenu>
      </>,
    );

    const nativeSelect = screen.getByTestId("status-select");
    const trigger = screen.getByTestId("status-select-trigger");

    expect(nativeSelect.tagName).toBe("SELECT");
    expect(nativeSelect).toHaveClass("sr-only");
    expect(nativeSelect).toHaveAttribute("aria-hidden", "true");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("id", "status-trigger");
    expect(trigger).toHaveAccessibleName("Status To do");
    expect(trigger).not.toHaveClass("sr-only");
    expect(
      screen.getByRole("button", { name: "Status To do" }),
    ).toBeInTheDocument();
  });

  it("keeps an aria-label on the visible trigger", () => {
    render(
      <SelectMenu
        aria-label="Priority"
        data-testid="priority-select"
        value="high"
        onChange={() => undefined}
      >
        <option value="low">Low</option>
        <option value="high">High</option>
      </SelectMenu>,
    );

    expect(screen.getByTestId("priority-select")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("priority-select-trigger")).toHaveAccessibleName(
      "Priority High",
    );
  });

  it("derives a trigger label from wrapping labels without flattening spaces", async () => {
    render(
      <label>
        <span>Severity</span>
        <SelectMenu
          data-testid="severity-select"
          value="major"
          onChange={() => undefined}
        >
          <option value="minor">Minor issue</option>
          <option value="major">Major issue</option>
        </SelectMenu>
      </label>,
    );

    const trigger = screen.getByTestId("severity-select-trigger");

    await waitFor(() =>
      expect(trigger).toHaveAccessibleName("Severity Major issue"),
    );
    expect(trigger).not.toHaveAccessibleName(/Majorissue/u);
  });
});
