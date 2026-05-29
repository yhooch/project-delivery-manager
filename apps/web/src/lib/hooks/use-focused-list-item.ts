"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_HIGHLIGHT_DURATION_MS = 2400;
const FOCUSED_ITEM_SCROLL_MARGIN_TOP = "7rem";

export function useFocusedListItem<TElement extends HTMLElement>({
  focusedId,
  isLoading = false,
  resetKey,
}: {
  focusedId?: string;
  isLoading?: boolean;
  resetKey?: string;
}) {
  const itemRefs = useRef(new Map<string, TElement>());
  const timeoutRef = useRef<number | null>(null);
  const focusedTokenRef = useRef<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const focusedToken = focusedId ? `${resetKey ?? ""}:${focusedId}` : null;

  const clearHighlightTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const focusItem = useCallback(
    (id = focusedId) => {
      if (
        !id ||
        !focusedToken ||
        id !== focusedId ||
        isLoading ||
        focusedTokenRef.current === focusedToken
      ) {
        return;
      }

      const node = itemRefs.current.get(id);
      if (!node) {
        return;
      }

      node.style.scrollMarginTop ||= FOCUSED_ITEM_SCROLL_MARGIN_TOP;
      node.scrollIntoView?.({ block: "start" });
      focusedTokenRef.current = focusedToken;
      setHighlightedId(id);
      clearHighlightTimeout();
      timeoutRef.current = window.setTimeout(() => {
        setHighlightedId((current) => (current === id ? null : current));
        timeoutRef.current = null;
      }, DEFAULT_HIGHLIGHT_DURATION_MS);
    },
    [clearHighlightTimeout, focusedId, focusedToken, isLoading],
  );

  const registerItem = useCallback(
    (id: string) => (node: TElement | null) => {
      if (node) {
        itemRefs.current.set(id, node);
        focusItem(id);
      } else {
        itemRefs.current.delete(id);
      }
    },
    [focusItem],
  );

  useEffect(() => {
    if (!focusedToken) {
      focusedTokenRef.current = null;
      setHighlightedId(null);
      return;
    }

    if (focusedTokenRef.current !== focusedToken) {
      setHighlightedId(null);
    }
  }, [focusedToken]);

  useEffect(() => {
    focusItem();
  }, [focusItem]);

  useEffect(() => clearHighlightTimeout, [clearHighlightTimeout]);

  return { highlightedId, registerItem };
}
