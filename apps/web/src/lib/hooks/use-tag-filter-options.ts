"use client";

import type { TagDto, TagFilterOptionScope } from "@project-delivery/shared";
import { useCallback, useEffect, useState } from "react";

import { listTagFilterOptions } from "../tag-service";

export function useTagFilterOptions({
  organizationId,
  scope,
  spaceId,
}: {
  organizationId?: string;
  scope: TagFilterOptionScope;
  spaceId?: string;
}) {
  const [items, setItems] = useState<TagDto[]>([]);
  const [reloadVersion, setReloadVersion] = useState(0);

  const reload = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!spaceId) {
      setItems([]);
      return;
    }

    let cancelled = false;

    void listTagFilterOptions({
      organizationId,
      scope,
      spaceId,
    })
      .then((result) => {
        if (!cancelled) {
          setItems(result.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId, reloadVersion, scope, spaceId]);

  return {
    items,
    reload,
  };
}
