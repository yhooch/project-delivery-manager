import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button";
import { Input } from "./input";

afterEach(() => {
  cleanup();
});

describe("Button", () => {
  it("mirrors native disabled state to aria-disabled", () => {
    render(<Button disabled>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps Radix Slot composition when disabled asChild is rendered", () => {
    render(
      <Button asChild disabled>
        <a href="/settings">Settings</a>
      </Button>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Input", () => {
  it("mirrors native disabled state to aria-disabled", () => {
    render(<Input aria-label="Space name" disabled />);

    const input = screen.getByLabelText("Space name");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-disabled", "true");
  });
});
