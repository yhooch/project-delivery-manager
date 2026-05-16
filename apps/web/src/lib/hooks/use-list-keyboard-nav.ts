"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Options for {@link useListKeyboardNav}.
 *
 * The hook implements the Notion 04.2 keyboard navigation contract for any
 * vertically-stacked list with an optional detail drawer:
 *
 * - `j` / `ArrowDown` → highlight next item (calls `onSelect`).
 * - `k` / `ArrowUp`   → highlight previous item (calls `onSelect`).
 * - `Enter`           → open the highlighted item (calls `onOpen`).
 * - `e`               → edit/open the highlighted item (calls `onEdit`, or
 *   falls back to `onOpen`).
 * - `a`               → open the assign affordance when provided and allowed.
 * - `s`               → trigger the conservative submit/action shortcut when
 *   provided and allowed. Callers should open/focus the action affordance, not
 *   directly commit workflow actions.
 * - `Escape`          → close the detail drawer (calls `onClose`).
 *
 * If no item is currently highlighted (`activeId` not in `items`), the first
 * `j`/`k`/ArrowDown/ArrowUp keystroke will select the first item rather than
 * scrolling past the boundary.
 */
export type UseListKeyboardNavOptions<T> = {
  items: T[];
  activeId: string | undefined;
  getId: (item: T) => string;
  onSelect: (item: T) => void;
  onOpen?: (item: T) => void;
  onEdit?: (item: T) => void;
  onAssign?: (item: T) => void;
  onSubmit?: (item: T) => void;
  canAssign?: (item: T) => boolean;
  canSubmit?: (item: T) => boolean;
  onClose?: () => void;
  enabled?: boolean;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return false;
}

export function useListKeyboardNav<T>(
  opts: UseListKeyboardNavOptions<T>,
): void {
  // Cache the latest opts on a ref so that we don't have to re-bind the
  // global keydown listener on every render. The handler reads `optsRef`
  // synchronously when an event fires.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const current = optsRef.current;
      if (current.enabled === false) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      const items = current.items;
      const key = event.key;
      const isDown = key === "j" || key === "ArrowDown";
      const isUp = key === "k" || key === "ArrowUp";
      const isEnter = key === "Enter";
      const isEdit = key.toLowerCase() === "e";
      const isAssign = key.toLowerCase() === "a";
      const isSubmit = key.toLowerCase() === "s";
      const isEscape = key === "Escape";

      if (isEscape) {
        if (current.onClose) {
          event.preventDefault();
          current.onClose();
        }
        return;
      }

      if (items.length === 0) {
        return;
      }

      if (isDown || isUp) {
        event.preventDefault();
        const currentIndex = current.activeId
          ? items.findIndex((item) => current.getId(item) === current.activeId)
          : -1;

        let nextIndex: number;
        if (currentIndex === -1) {
          nextIndex = 0;
        } else if (isDown) {
          nextIndex = Math.min(currentIndex + 1, items.length - 1);
        } else {
          nextIndex = Math.max(currentIndex - 1, 0);
        }
        const nextItem = items[nextIndex];
        if (nextItem) {
          current.onSelect(nextItem);
        }
        return;
      }

      if (isEnter || isEdit || isAssign || isSubmit) {
        if (!current.activeId) {
          return;
        }
        const activeItem = items.find(
          (item) => current.getId(item) === current.activeId,
        );
        if (!activeItem) {
          return;
        }

        const action = isEnter
          ? current.onOpen
          : isEdit
            ? (current.onEdit ?? current.onOpen)
            : isAssign
              ? current.canAssign?.(activeItem) === false
                ? undefined
                : current.onAssign
              : current.canSubmit?.(activeItem) === false
                ? undefined
                : current.onSubmit;

        if (action) {
          event.preventDefault();
          action(activeItem);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);
}

function getCurrentFocusTarget(): HTMLElement | null {
  if (
    typeof document === "undefined" ||
    !(document.activeElement instanceof HTMLElement) ||
    document.activeElement === document.body
  ) {
    return null;
  }

  return document.activeElement;
}

function canRestoreFocus(element: HTMLElement): boolean {
  return (
    typeof document !== "undefined" &&
    document.contains(element) &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true"
  );
}

export function useFocusReturn() {
  const triggerRef = useRef<HTMLElement | null>(null);

  const captureFocus = useCallback((target?: HTMLElement | null) => {
    triggerRef.current = target ?? getCurrentFocusTarget();
  }, []);

  const restoreFocus = useCallback(() => {
    const target = triggerRef.current;
    triggerRef.current = null;

    if (!target) {
      return;
    }

    const schedule =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame
        : (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 0);

    schedule(() => {
      if (canRestoreFocus(target)) {
        target.focus({ preventScroll: true });
      }
    });
  }, []);

  return { captureFocus, restoreFocus };
}
