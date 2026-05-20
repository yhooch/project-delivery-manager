"use client";

import type { TagDto } from "@project-delivery/shared";

import { cn } from "../../lib/utils";
import { ListTagRail } from "../tag";

import { CreatedMeta } from "./created-meta";

type ListItemMetaRowProps = {
  className?: string;
  createdAt?: string;
  creatorName?: string;
  tagBadgeClassName?: string;
  tagMaxVisible?: number;
  tags?: readonly TagDto[];
};

export function ListItemMetaRow({
  className,
  createdAt,
  creatorName,
  tagBadgeClassName,
  tagMaxVisible,
  tags,
}: ListItemMetaRowProps) {
  const hasCreatedMeta = Boolean(createdAt || creatorName);
  const hasTags = Boolean(tags?.length);

  if (!hasCreatedMeta && !hasTags) {
    return null;
  }

  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <CreatedMeta
        className="min-w-0 max-w-none shrink truncate"
        createdAt={createdAt}
        creatorName={creatorName}
      />
      <ListTagRail
        badgeClassName={tagBadgeClassName}
        className="min-w-0 flex-1"
        listClassName="max-h-4 flex-nowrap"
        maxVisible={tagMaxVisible}
        tags={tags}
      />
    </span>
  );
}
