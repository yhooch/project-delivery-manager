import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

afterEach(() => {
  cleanup();
});

describe("dialog and sheet primitives", () => {
  it("localizes the dialog close label and keeps small screens scrollable", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(
      screen.getByRole("button", { name: "common.actions.close" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.actions.close" })).toHaveClass(
      "[@media(pointer:coarse)]:h-11",
    );
    expect(screen.getByRole("dialog")).toHaveClass("overflow-y-auto");
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[calc(100dvh-2rem)]");
  });

  it("localizes the sheet close label and allows sheet content to scroll", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(
      screen.getByRole("button", { name: "common.actions.close" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.actions.close" })).toHaveClass(
      "[@media(pointer:coarse)]:h-11",
    );
    expect(screen.getByRole("dialog")).toHaveClass("overflow-y-auto");
  });
});
