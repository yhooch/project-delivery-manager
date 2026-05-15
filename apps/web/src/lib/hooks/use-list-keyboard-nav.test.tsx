import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useListKeyboardNav } from "./use-list-keyboard-nav";

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
  canSubmit,
  onAssign,
  onEdit,
  onOpen,
  onSelect = () => undefined,
  onSubmit,
}: {
  activeId?: string;
  canSubmit?: (item: Item) => boolean;
  onAssign?: (item: Item) => void;
  onEdit?: (item: Item) => void;
  onOpen?: (item: Item) => void;
  onSelect?: (item: Item) => void;
  onSubmit?: (item: Item) => void;
}) {
  useListKeyboardNav<Item>({
    items,
    activeId,
    getId: (item) => item.id,
    onAssign,
    canSubmit,
    onEdit,
    onOpen,
    onSelect,
    onSubmit,
  });

  return <input aria-label="field" />;
}

describe("useListKeyboardNav", () => {
  it("maps e/a/s to edit, assign, and submit callbacks for the active item", () => {
    const onEdit = vi.fn();
    const onAssign = vi.fn();
    const onSubmit = vi.fn();

    render(
      <Harness
        onAssign={onAssign}
        onEdit={onEdit}
        onSubmit={onSubmit}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));

    expect(onEdit).toHaveBeenCalledWith(items[0]);
    expect(onAssign).toHaveBeenCalledWith(items[0]);
    expect(onSubmit).toHaveBeenCalledWith(items[0]);
  });

  it("uses onOpen as the edit fallback when no explicit edit callback exists", () => {
    const onOpen = vi.fn();

    render(<Harness onOpen={onOpen} />);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));

    expect(onOpen).toHaveBeenCalledWith(items[0]);
  });

  it("ignores action keys when no item is active or focus is in an editable field", () => {
    const onSubmit = vi.fn();
    const { getByLabelText, rerender } = render(
      <Harness activeId="missing" onSubmit={onSubmit} />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<Harness onSubmit={onSubmit} />);
    getByLabelText("field").dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not prevent or run submit when the active item has no executable submit action", () => {
    const onSubmit = vi.fn();

    render(
      <Harness
        canSubmit={(item) => item.id === "two"}
        onSubmit={onSubmit}
      />,
    );

    const event = new KeyboardEvent("keydown", {
      key: "s",
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
