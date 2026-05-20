"use client";

import type { TagDto, TagMatch } from "@project-delivery/shared";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  normalizeTagFilterState,
  type TagFilterState,
} from "../../lib/tag-query";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tip } from "../ui/tooltip";

import { TagField } from "./tag-assignment-field";
import { type TagPickerCreateTag, type TagPickerListTags } from "./tag-picker";

export type TagFilterProps = {
  allowCreate?: boolean;
  className?: string;
  createTagAction?: TagPickerCreateTag;
  disabled?: boolean;
  listTagsAction?: TagPickerListTags;
  onChange: (value: TagFilterState, selectedTags: TagDto[]) => void;
  organizationId?: string;
  readOnly?: boolean;
  selectedTags: readonly TagDto[];
  showMatchMode?: boolean;
  spaceId: string;
  value: Partial<TagFilterState>;
  "data-testid"?: string;
};

const MATCH_MODES: TagMatch[] = ["ANY", "ALL"];

export function TagFilter({
  allowCreate = false,
  className,
  createTagAction,
  disabled = false,
  listTagsAction,
  onChange,
  organizationId,
  readOnly = false,
  selectedTags,
  showMatchMode = true,
  spaceId,
  value,
  "data-testid": testId,
}: TagFilterProps) {
  const t = useTranslations("tags.filter");
  const normalizedValue = normalizeTagFilterState(value);
  const isInteractive = !disabled && !readOnly;
  const selectedById = React.useMemo(
    () => new Map(selectedTags.map((tag) => [tag.id, tag])),
    [selectedTags],
  );
  const orderedSelectedTags = normalizedValue.tagIds.flatMap((tagId) => {
    const tag = selectedById.get(tagId);
    return tag ? [tag] : [];
  });

  function emit(nextTagIds: string[], nextTagMatch = normalizedValue.tagMatch) {
    const nextValue = normalizeTagFilterState({
      tagIds: nextTagIds,
      tagMatch: nextTagMatch,
    });
    const nextSelectedTags = nextValue.tagIds.flatMap((tagId) => {
      const tag = selectedById.get(tagId);
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

  function handleSelectedTagsChange(nextTags: TagDto[]) {
    const nextValue = normalizeTagFilterState({
      tagIds: nextTags.map((tag) => tag.id),
      tagMatch: normalizedValue.tagMatch,
    });

    onChange(nextValue, nextTags);
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
        <TagField
          allowCreate={allowCreate}
          className="min-w-48 flex-1 shadow-none"
          createTagAction={createTagAction}
          disabled={disabled}
          emptyLabel={t("empty")}
          getRemoveLabel={(tag) => t("remove", { name: tag.displayName })}
          listTagsAction={listTagsAction}
          onSelectedTagsChange={handleSelectedTagsChange}
          organizationId={organizationId}
          pickerPlaceholder={t("placeholder")}
          readOnly={readOnly}
          selectedTags={orderedSelectedTags}
          spaceId={spaceId}
          testId={testId}
          variant="filter"
        />
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
