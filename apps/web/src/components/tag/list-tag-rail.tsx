"use client";

import type { TagDto } from "@project-delivery/shared";

import { cn } from "../../lib/utils";

import { TagBadgeList } from "./tag-assignment-field";

export function ListTagRail({
  badgeClassName,
  className,
  maxVisible = 8,
  tags,
}: {
  badgeClassName?: string;
  className?: string;
  maxVisible?: number;
  tags?: readonly TagDto[];
}) {
  if (!tags || tags.length === 0) {
    return null;
  }

  const resolvedBadgeClassName = cn(
    "min-w-0 max-w-28 shrink sm:max-w-32 lg:max-w-36",
    badgeClassName,
  );

  return (
    <span className={cn("block min-w-0", className)}>
      <TagBadgeList
        badgeClassName={resolvedBadgeClassName}
        className="max-h-11 overflow-hidden"
        maxVisible={maxVisible}
        tags={tags}
      />
    </span>
  );
}
