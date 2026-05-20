"use client";

import type { TagDto, TagMatch } from "@project-delivery/shared";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  normalizeTagFilterState,
  type TagFilterState,
} from "../../lib/tag-query";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tip } from "../ui/tooltip";

import { formatTagDisplayName } from "./tag-badge";

export type TagFilterProps = {
  availableTags?: readonly TagDto[];
  className?: string;
  disabled?: boolean;
  onChange: (value: TagFilterState, selectedTags: TagDto[]) => void;
  readOnly?: boolean;
  selectedTags: readonly TagDto[];
  showMatchMode?: boolean;
  value: Partial<TagFilterState>;
  "aria-label"?: string;
  "data-testid"?: string;
};

const MATCH_MODES: TagMatch[] = ["ANY", "ALL"];

export function TagFilter({
  availableTags = [],
  className,
  disabled = false,
  onChange,
  readOnly = false,
  selectedTags,
  showMatchMode = true,
  value,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: TagFilterProps) {
  const t = useTranslations("tags.filter");
  const normalizedValue = normalizeTagFilterState(value);
  const isInteractive = !disabled && !readOnly;
  const optionTags = React.useMemo(
    () => mergeTags(availableTags, selectedTags),
    [availableTags, selectedTags],
  );
  const tagById = React.useMemo(
    () => new Map(optionTags.map((tag) => [tag.id, tag])),
    [optionTags],
  );
  const orderedSelectedTags = normalizedValue.tagIds.flatMap((tagId) => {
    const tag = tagById.get(tagId);
    return tag ? [tag] : [];
  });
  const triggerLabel =
    orderedSelectedTags.length > 0
      ? orderedSelectedTags.map(formatTagDisplayName).join(" ")
      : t("empty");

  function emit(nextTagIds: string[], nextTagMatch = normalizedValue.tagMatch) {
    const nextValue = normalizeTagFilterState({
      tagIds: nextTagIds,
      tagMatch: nextTagMatch,
    });
    const nextSelectedTags = nextValue.tagIds.flatMap((tagId) => {
      const tag = tagById.get(tagId);
      return tag ? [tag] : [];
    });

    onChange(nextValue, nextSelectedTags);
  }

  function handleClear() {
    if (!isInteractive) {
      return;
    }

    onChange(
      normalizeTagFilterState({
        tagIds: [],
        tagMatch: normalizedValue.tagMatch,
      }),
      [],
    );
  }

  function handleMatchChange(tagMatch: TagMatch) {
    if (!isInteractive || normalizedValue.tagMatch === tagMatch) {
      return;
    }

    emit(normalizedValue.tagIds, tagMatch);
  }

  function toggleTag(tag: TagDto) {
    if (!isInteractive) {
      return;
    }

    const currentIds = normalizedValue.tagIds;
    const nextTagIds = currentIds.includes(tag.id)
      ? currentIds.filter((tagId) => tagId !== tag.id)
      : [...currentIds, tag.id];

    emit(nextTagIds);
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {showMatchMode && (
          <div
            className="inline-flex rounded-md border border-border bg-background p-0.5"
            role="group"
            aria-label={t("matchMode")}
          >
            {MATCH_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!isInteractive}
                aria-pressed={normalizedValue.tagMatch === mode}
                onClick={() => handleMatchChange(mode)}
                className={cn(
                  "h-7 rounded-sm px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  normalizedValue.tagMatch === mode
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {t(`match.${mode}`)}
              </button>
            ))}
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!isInteractive}>
            <button
              type="button"
              className={cn(
                "flex h-8 min-w-48 flex-1 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm text-foreground shadow-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              data-testid={testId}
              disabled={!isInteractive}
              aria-label={ariaLabel}
              title={triggerLabel}
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  orderedSelectedTags.length === 0 && "text-muted-foreground",
                )}
              >
                {triggerLabel}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto">
            <DropdownMenuItem
              data-testid={testId ? `${testId}-option-empty` : undefined}
              onSelect={handleClear}
              className="whitespace-nowrap"
            >
              <span
                className={cn(
                  "flex-1 truncate whitespace-nowrap",
                  orderedSelectedTags.length === 0 && "font-medium",
                )}
              >
                {t("empty")}
              </span>
            </DropdownMenuItem>
            {optionTags.length > 0 ? <DropdownMenuSeparator /> : null}
            {optionTags.map((tag) => {
              const checked = normalizedValue.tagIds.includes(tag.id);

              return (
                <DropdownMenuCheckboxItem
                  key={tag.id}
                  checked={checked}
                  data-testid={testId ? `${testId}-option-${tag.id}` : undefined}
                  onCheckedChange={() => toggleTag(tag)}
                  onSelect={(event) => event.preventDefault()}
                  className="whitespace-nowrap"
                >
                  <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                    {formatTagDisplayName(tag)}
                  </span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {orderedSelectedTags.length > 0 && (
          <Tip content={t("clear")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("clear")}
              disabled={!isInteractive}
              onClick={handleClear}
            >
              <X aria-hidden="true" />
            </Button>
          </Tip>
        )}
      </div>
    </div>
  );
}

function mergeTags(
  availableTags: readonly TagDto[],
  selectedTags: readonly TagDto[],
) {
  const byId = new Map<string, TagDto>();

  for (const tag of selectedTags) {
    byId.set(tag.id, tag);
  }

  for (const tag of availableTags) {
    byId.set(tag.id, tag);
  }

  return Array.from(byId.values()).sort((left, right) =>
    formatTagDisplayName(left).localeCompare(formatTagDisplayName(right)),
  );
}
