import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeader } from "./page-header";

afterEach(() => {
  cleanup();
});

describe("PageHeader", () => {
  it("lets actions stack and wrap without squeezing the title on small screens", () => {
    const { container } = render(
      <PageHeader
        title="Backlog triage"
        actions={
          <>
            <button type="button">Create task</button>
            <button type="button">Export report</button>
          </>
        }
      />,
    );

    const mainRow = container.querySelector("header > div");
    const titleBlock = screen.getByRole("heading", {
      name: "Backlog triage",
    }).parentElement;
    const actions = screen.getByRole("button", {
      name: "Create task",
    }).parentElement;

    expect(mainRow).toHaveClass("flex-col", "sm:flex-row");
    expect(titleBlock).toHaveClass("min-w-0", "sm:flex-1");
    expect(actions).toHaveClass(
      "w-full",
      "flex-col",
      "sm:w-auto",
      "sm:flex-row",
      "sm:flex-wrap",
    );
  });
});
