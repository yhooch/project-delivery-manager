import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useFocusReturn, useListKeyboardNav } from "./use-list-keyboard-nav";

type Item = {
  id: string;
  title: string;
};

const items: Item[] = [
  { id: "one", title: "One" },
  { id: "two", title: "Two" },
];

function Harness({
  activeId = "one",
  canFocusActionArea,
  onAssign,
  onEdit,
  onFocusActionArea,
  onOpen,
  onSelect = () => undefined,
}: {
  activeId?: string;
  canFocusActionArea?: (item: Item) => boolean;
  onAssign?: (item: Item) => void;
  onEdit?: (item: Item) => void;
  onFocusActionArea?: (item: Item) => void;
  onOpen?: (item: Item) => void;
  onSelect?: (item: Item) => void;
}) {
  useListKeyboardNav<Item>({
    items,
    activeId,
    getId: (item) => item.id,
    onAssign,
    canSubmit: canFocusActionArea,
    onEdit,
    onOpen,
    onSelect,
    onSubmit: onFocusActionArea,
  });

  return <input aria-label="field" />;
}

describe("useListKeyboardNav", () => {
  it("maps e/a/s to edit, assign, and action UI callbacks for the active item", () => {
    const onEdit = vi.fn();
    const onAssign = vi.fn();
    const onFocusActionArea = vi.fn();

    render(
      <Harness
        onAssign={onAssign}
        onEdit={onEdit}
        onFocusActionArea={onFocusActionArea}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));

    expect(onEdit).toHaveBeenCalledWith(items[0]);
    expect(onAssign).toHaveBeenCalledWith(items[0]);
    expect(onFocusActionArea).toHaveBeenCalledWith(items[0]);
  });

  it("uses onOpen as the edit fallback when no explicit edit callback exists", () => {
    const onOpen = vi.fn();

    render(<Harness onOpen={onOpen} />);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));

    expect(onOpen).toHaveBeenCalledWith(items[0]);
  });

  it("does not prevent A when no assign affordance is provided", () => {
    render(<Harness />);

    const event = new KeyboardEvent("keydown", {
      key: "a",
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores action keys when no item is active or focus is in an editable field", () => {
    const onFocusActionArea = vi.fn();
    const { getByLabelText, rerender } = render(
      <Harness activeId="missing" onFocusActionArea={onFocusActionArea} />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    expect(onFocusActionArea).not.toHaveBeenCalled();

    rerender(<Harness onFocusActionArea={onFocusActionArea} />);
    getByLabelText("field").dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true }),
    );

    expect(onFocusActionArea).not.toHaveBeenCalled();
  });

  it("does not prevent or run the action UI shortcut when unavailable", () => {
    const onFocusActionArea = vi.fn();

    render(
      <Harness
        canFocusActionArea={(item) => item.id === "two"}
        onFocusActionArea={onFocusActionArea}
      />,
    );

    const event = new KeyboardEvent("keydown", {
      key: "s",
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onFocusActionArea).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

function FocusReturnHarness() {
  const [open, setOpen] = useState(false);
  const { captureFocus, restoreFocus } = useFocusReturn();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          captureFocus();
          setOpen(true);
        }}
      >
        open
      </button>
      {open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            restoreFocus();
          }}
        >
          close
        </button>
      ) : null}
    </>
  );
}

describe("useFocusReturn", () => {
  it("restores focus to the trigger after a controlled drawer closes", async () => {
    render(<FocusReturnHarness />);

    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("button", { name: "close" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close" }));

    await waitFor(() => expect(opener).toHaveFocus());
  });
});
