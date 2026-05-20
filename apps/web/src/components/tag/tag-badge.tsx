"use client";

import type { TagDto } from "@project-delivery/shared";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { cn } from "../../lib/utils";

import { getTagColorClassName, getTagTextColorClassName } from "./tag-colors";

export type TagBadgeData = Pick<TagDto, "colorKey" | "displayName" | "name">;

export type TagBadgeProps = Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "children"
> & {
  disabled?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  tag: TagBadgeData;
  variant?: "meta" | "form" | "filter";
};

export function TagBadge({
  className,
  disabled,
  onRemove,
  removeLabel,
  tag,
  variant = "form",
  ...props
}: TagBadgeProps) {
  const t = useTranslations("tags.badge");
  const displayName = formatTagDisplayName(tag);
  const canRemove = Boolean(onRemove);
  const computedRemoveLabel = removeLabel ?? t("remove", { name: displayName });

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 font-medium leading-4 transition-colors",
        variant === "form"
          ? "rounded-md border px-1.5 py-0.5 text-[11px]"
          : variant === "filter"
            ? "rounded-md border px-1.5 py-0 text-[11px]"
            : "px-0 py-0 text-[11px]",
        variant === "meta"
          ? getTagTextColorClassName(tag.colorKey)
          : getTagColorClassName(tag.colorKey),
        className,
      )}
      title={displayName}
      {...props}
    >
      <span className="min-w-0 truncate">{displayName}</span>
      {canRemove && (
        <button
          type="button"
          aria-label={computedRemoveLabel}
          title={computedRemoveLabel}
          disabled={disabled}
          onClick={onRemove}
          className={cn(
            "-mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-current/70 transition-colors",
            "hover:bg-foreground/10 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-45",
          )}
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function formatTagDisplayName(
  tag: Pick<TagBadgeData, "displayName" | "name">,
) {
  return tag.displayName || `#${tag.name}`;
}
