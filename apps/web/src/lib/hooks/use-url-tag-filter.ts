"use client";

import type { TagMatch } from "@project-delivery/shared";
import { useCallback, useEffect, useState } from "react";

import {
  normalizeTagFilterState,
  parseTagFilterQuery,
  toTagFilterSearchParams,
  type TagFilterState,
} from "../tag-query";

type SearchParamsLike = {
  toString: () => string;
};

type UrlReplacingRouter = {
  replace: (href: never, options?: { scroll?: boolean }) => void;
};

export function useUrlTagFilter({
  fixedTagMatch,
  pathname,
  router,
  searchParams,
}: {
  fixedTagMatch?: TagMatch;
  pathname: string;
  router: UrlReplacingRouter;
  searchParams: SearchParamsLike;
}): [TagFilterState, (value: Partial<TagFilterState>) => void] {
  const searchKey = searchParams.toString();
  const normalize = useCallback(
    (value: Partial<TagFilterState>) =>
      normalizeTagFilterState({
        ...value,
        tagMatch: fixedTagMatch ?? value.tagMatch,
      }),
    [fixedTagMatch],
  );
  const [value, setValue] = useState<TagFilterState>(() =>
    normalize(parseTagFilterQuery(new URLSearchParams(searchKey))),
  );

  useEffect(() => {
    const nextValue = normalize(
      parseTagFilterQuery(new URLSearchParams(searchKey)),
    );

    setValue((current) =>
      areTagFiltersEqual(current, nextValue) ? current : nextValue,
    );
  }, [normalize, searchKey]);

  const updateValue = useCallback(
    (nextValue: Partial<TagFilterState>) => {
      const normalized = normalize(nextValue);
      const params = new URLSearchParams(searchKey);
      params.delete("tagIds");
      params.delete("tagMatch");

      const tagParams = toTagFilterSearchParams(normalized);
      tagParams.forEach((paramValue, key) => {
        params.set(key, paramValue);
      });

      setValue(normalized);
      const query = params.toString();
      router.replace((query ? `${pathname}?${query}` : pathname) as never, {
        scroll: false,
      });
    },
    [normalize, pathname, router, searchKey],
  );

  return [value, updateValue];
}

function areTagFiltersEqual(left: TagFilterState, right: TagFilterState) {
  return (
    left.tagMatch === right.tagMatch &&
    left.tagIds.length === right.tagIds.length &&
    left.tagIds.every((tagId, index) => tagId === right.tagIds[index])
  );
}
