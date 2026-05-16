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
    expect(nativeSelect).toHaveAccessibleName("Status");
    expect(screen.getByLabelText("Status")).toBe(nativeSelect);
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("id", "status-trigger");
    await waitFor(() => expect(trigger).toHaveAccessibleName(/Status/u));
    expect(trigger).toHaveAccessibleName(/Todo/u);
    expect(trigger).not.toHaveClass("sr-only");
    expect(
      screen.getByRole("button", { name: /Status/u }),
    ).toBeInTheDocument();
  });

  it("keeps an aria-label on both the semantic select and visible trigger", () => {
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

    expect(screen.getByTestId("priority-select")).toHaveAccessibleName(
      "Priority",
    );
    expect(screen.getByLabelText("Priority")).toBe(
      screen.getByTestId("priority-select"),
    );
    expect(screen.getByTestId("priority-select-trigger")).toHaveAccessibleName(
      /Priority/u,
    );
    expect(screen.getByTestId("priority-select-trigger")).toHaveAccessibleName(
      /High/u,
    );
  });
});
