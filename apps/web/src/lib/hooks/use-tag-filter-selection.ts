"use client";

import type { TagDto } from "@project-delivery/shared";
import { useEffect, useMemo, useState } from "react";

import { listTags } from "../tag-service";
import { selectTagsByIds } from "../tag-ui";

export function useTagFilterSelection({
  organizationId,
  sourceTags,
  spaceId,
  tagIds,
}: {
  organizationId?: string;
  sourceTags: readonly TagDto[];
  spaceId?: string;
  tagIds: readonly string[];
}) {
  const tagIdsKey = tagIds.join(",");
  const [loadedTags, setLoadedTags] = useState<TagDto[]>([]);

  useEffect(() => {
    if (!spaceId || tagIds.length === 0) {
      setLoadedTags([]);
      return;
    }

    let cancelled = false;

    void listTags({
      organizationId,
      page: 1,
      pageSize: 100,
      spaceId,
    })
      .then((result) => {
        if (!cancelled) {
          setLoadedTags(result.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedTags([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId, spaceId, tagIds.length, tagIdsKey]);

  const selectedTags = useMemo(
    () => selectTagsByIds(tagIds, loadedTags, sourceTags),
    [loadedTags, sourceTags, tagIds, tagIdsKey],
  );

  return {
    selectedTags,
    setSelectedTags: setLoadedTags,
  };
}
