"use client";

import type { TagDto, TagTargetType } from "@project-delivery/shared";
import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { replaceTagAssignments } from "../../lib/tag-service";
import { getTagIds } from "../../lib/tag-ui";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tip } from "../ui/tooltip";

import { TagBadge, formatTagDisplayName } from "./tag-badge";
import { TagPicker } from "./tag-picker";

const DEFAULT_TAG_BADGE_MAX_VISIBLE = 3;

export function TagBadgeList({
  badgeClassName,
  className,
  emptyLabel,
  maxVisible,
  tags,
  variant = "meta",
}: {
  badgeClassName?: string;
  className?: string;
  emptyLabel?: string;
  maxVisible?: number;
  tags?: readonly TagDto[];
  variant?: "meta" | "form" | "filter";
}) {
  const safeTags = tags ?? [];
  const resolvedMaxVisible = maxVisible ?? DEFAULT_TAG_BADGE_MAX_VISIBLE;
  const visibleTags = safeTags.slice(0, resolvedMaxVisible);
  const hiddenTags = safeTags.slice(resolvedMaxVisible);
  const hiddenTagNames = hiddenTags.map(formatTagDisplayName);
  const hiddenTagSummary = hiddenTagNames.join(" ");
  const overflowCount = safeTags.length - visibleTags.length;

  if (safeTags.length === 0) {
    return emptyLabel ? (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {emptyLabel}
      </span>
    ) : null;
  }

  return (
    <span
      className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}
    >
      {visibleTags.map((tag) => (
        <TagBadge
          key={tag.id}
          className={badgeClassName}
          tag={tag}
          variant={variant}
        />
      ))}
      {overflowCount > 0 ? (
        <Tip key="overflow" content={hiddenTagSummary}>
          <span
            aria-label={hiddenTagNames.join(", ")}
            title={hiddenTagSummary}
            className={cn(
              "inline-flex shrink-0 items-center text-[11px] font-medium text-muted-foreground",
              variant === "meta"
                ? "h-4 px-0"
                : "h-5 rounded-md border border-border bg-muted px-1.5",
            )}
          >
            +{overflowCount}
          </span>
        </Tip>
      ) : null}
    </span>
  );
}

export function TagSelectionField({
  allowCreate = true,
  className,
  disabled = false,
  emptyLabel,
  onSelectedTagsChange,
  organizationId,
  pickerPlaceholder,
  pickerPanelMaxHeightClassName,
  pickerPanelPlacement,
  readOnly = false,
  selectedTags,
  spaceId,
  testId,
  variant = "form",
}: {
  allowCreate?: boolean;
  className?: string;
  disabled?: boolean;
  emptyLabel?: string;
  onSelectedTagsChange: (tags: TagDto[]) => void | Promise<void>;
  organizationId?: string;
  pickerPlaceholder?: string;
  pickerPanelMaxHeightClassName?: string;
  pickerPanelPlacement?: React.ComponentProps<
    typeof TagPicker
  >["panelPlacement"];
  readOnly?: boolean;
  selectedTags: readonly TagDto[];
  spaceId: string;
  testId?: string;
  variant?: TagFieldVariant;
}) {
  const t = useTranslations("tags.field");
  const resolvedEmptyLabel = emptyLabel ?? t("empty");
  const resolvedPickerPlaceholder = pickerPlaceholder ?? t("placeholder");

  return (
    <TagField
      allowCreate={allowCreate}
      className={className}
      disabled={disabled}
      emptyLabel={resolvedEmptyLabel}
      onSelectedTagsChange={onSelectedTagsChange}
      organizationId={organizationId}
      pickerPlaceholder={resolvedPickerPlaceholder}
      pickerPanelMaxHeightClassName={pickerPanelMaxHeightClassName}
      pickerPanelPlacement={pickerPanelPlacement}
      readOnly={readOnly}
      selectedTags={selectedTags}
      spaceId={spaceId}
      testId={testId}
      variant={variant}
    />
  );
}

export type TagFieldVariant = "meta" | "form" | "filter";

export function TagField({
  allowCreate = true,
  className,
  createTagAction,
  disabled = false,
  emptyLabel,
  getRemoveLabel,
  listTagsAction,
  onSelectedTagsChange,
  organizationId,
  pickerPlaceholder,
  pickerPanelMaxHeightClassName,
  pickerPanelPlacement,
  readOnly = false,
  selectedTags,
  spaceId,
  testId,
  trailingElement,
  variant = "form",
}: {
  allowCreate?: boolean;
  className?: string;
  createTagAction?: React.ComponentProps<typeof TagPicker>["createTagAction"];
  disabled?: boolean;
  emptyLabel?: string;
  getRemoveLabel?: (tag: TagDto) => string;
  listTagsAction?: React.ComponentProps<typeof TagPicker>["listTagsAction"];
  onSelectedTagsChange: (tags: TagDto[]) => void | Promise<void>;
  organizationId?: string;
  pickerPlaceholder?: string;
  pickerPanelMaxHeightClassName?: string;
  pickerPanelPlacement?: React.ComponentProps<
    typeof TagPicker
  >["panelPlacement"];
  readOnly?: boolean;
  selectedTags: readonly TagDto[];
  spaceId: string;
  testId?: string;
  trailingElement?: React.ReactNode;
  variant?: TagFieldVariant;
}) {
  const t = useTranslations("tags.field");
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const pickerInputRef = React.useRef<HTMLInputElement | null>(null);
  const [showCompactPicker, setShowCompactPicker] = React.useState(false);
  const isInteractive = !disabled && !readOnly;
  const resolvedEmptyLabel = emptyLabel ?? t("empty");
  const resolvedPickerPlaceholder = pickerPlaceholder ?? t("placeholder");
  const isCompactVariant = variant === "meta" || variant === "filter";
  const showEmptyLabel =
    selectedTags.length === 0 && (!isInteractive || isCompactVariant);
  const showPicker = isInteractive && (!isCompactVariant || showCompactPicker);
  const resolvedPickerPanelPlacement =
    pickerPanelPlacement ?? (variant === "form" ? "top" : "bottom");
  const resolvedPickerPanelMaxHeight =
    pickerPanelMaxHeightClassName ??
    (variant === "form" ? "max-h-56" : "max-h-72");
  const addLabel = t("add");

  React.useEffect(() => {
    if (showCompactPicker) {
      pickerInputRef.current?.focus();
    }
  }, [showCompactPicker]);

  function removeTag(tagId: string) {
    if (!isInteractive) {
      return;
    }
    void onSelectedTagsChange(selectedTags.filter((tag) => tag.id !== tagId));
  }

  async function addTag(tag: TagDto) {
    if (!isInteractive || selectedTags.some((item) => item.id === tag.id)) {
      return;
    }
    await onSelectedTagsChange([...selectedTags, tag]);
    if (isCompactVariant) {
      setShowCompactPicker(false);
    }
  }

  function removeLastTag() {
    if (!isInteractive || selectedTags.length === 0) {
      return;
    }

    void onSelectedTagsChange(selectedTags.slice(0, -1));
  }

  function focusInput(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target;

    if (
      target instanceof HTMLElement &&
      (target.closest("button") || target.closest("input"))
    ) {
      return;
    }

    if (isCompactVariant && !showCompactPicker) {
      openCompactPicker();
      return;
    }

    pickerInputRef.current?.focus();
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (!isCompactVariant || rootRef.current?.contains(event.relatedTarget)) {
      return;
    }

    setShowCompactPicker(false);
  }

  function openCompactPicker() {
    if (!isInteractive) {
      return;
    }

    setShowCompactPicker(true);
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "min-w-0 flex-wrap items-center gap-1.5 text-sm transition-colors",
        variant === "form" &&
          "flex min-h-9 w-full rounded-md border border-input bg-background px-2 py-1 shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
        variant === "meta" && "inline-flex min-h-6 max-w-full py-0.5",
        variant === "filter" &&
          "flex min-h-8 w-full rounded-md border border-input bg-background px-2 py-1 shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
        disabled && "cursor-not-allowed opacity-50",
        readOnly && variant === "form" && "bg-muted/30",
        className,
      )}
      data-testid={testId}
      onBlur={handleBlur}
      onMouseDown={focusInput}
    >
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-1.5",
          variant === "meta" ? "max-w-full" : "flex-1",
        )}
        data-testid={testId ? `${testId}-selected` : undefined}
      >
        {selectedTags.length > 0 ? (
          selectedTags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              disabled={!isInteractive}
              onRemove={isInteractive ? () => removeTag(tag.id) : undefined}
              removeLabel={getRemoveLabel?.(tag)}
              variant={variant}
            />
          ))
        ) : showEmptyLabel ? (
          <span className="text-xs text-muted-foreground">
            {resolvedEmptyLabel}
          </span>
        ) : null}
        {showPicker ? (
          <TagPicker
            allowCreate={allowCreate}
            className={cn(
              "flex-1",
              variant === "form" ? "min-w-[9rem]" : "min-w-[8rem]",
            )}
            createTagAction={createTagAction}
            disabled={disabled}
            inputClassName={cn(
              "text-xs",
              variant !== "form" && "h-6 min-w-[8rem]",
            )}
            inputRef={pickerInputRef}
            listTagsAction={listTagsAction}
            onEmptyBackspace={removeLastTag}
            onSelect={addTag}
            organizationId={organizationId}
            panelMaxHeightClassName={resolvedPickerPanelMaxHeight}
            panelPlacement={resolvedPickerPanelPlacement}
            placeholder={resolvedPickerPlaceholder}
            readOnly={readOnly}
            selectedTags={selectedTags}
            spaceId={spaceId}
            variant="embedded"
            data-testid={testId ? `${testId}-picker` : undefined}
          />
        ) : null}
      </div>
      {isInteractive && isCompactVariant && !showCompactPicker ? (
        <Tip content={addLabel}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={addLabel}
            className="h-6 w-6 shrink-0"
            onClick={openCompactPicker}
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      ) : null}
      {trailingElement ? (
        <div className="ml-auto inline-flex shrink-0 items-center">
          {trailingElement}
        </div>
      ) : null}
    </div>
  );
}

export function ObjectTagAssignmentField({
  canEdit,
  className,
  onTagsChange,
  organizationId,
  spaceId,
  tags,
  targetId,
  targetType,
  testId,
  variant = "meta",
}: {
  canEdit: boolean;
  className?: string;
  onTagsChange?: (tags: TagDto[]) => void;
  organizationId?: string;
  spaceId: string;
  tags?: readonly TagDto[];
  targetId: string;
  targetType: TagTargetType;
  testId?: string;
  variant?: TagFieldVariant;
}) {
  const t = useTranslations("tags.field");
  const tRoot = useTranslations();
  const safeTags = tags ?? [];
  const [selectedTags, setSelectedTags] = React.useState<TagDto[]>(() => [
    ...safeTags,
  ]);
  const [saving, setSaving] = React.useState(false);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSelectedTags([...(tags ?? [])]);
    setErrorKey(null);
  }, [tags, targetId]);

  async function handleSelectedTagsChange(nextTags: TagDto[]) {
    if (!canEdit || saving) {
      return;
    }

    const previousTags = selectedTags;
    setSelectedTags(nextTags);
    setSaving(true);
    setErrorKey(null);

    try {
      const result = await replaceTagAssignments({
        tagIds: getTagIds(nextTags),
        targetId,
        targetType,
      });
      setSelectedTags(result.tags);
      onTagsChange?.(result.tags);
    } catch (error) {
      setSelectedTags(previousTags);
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <TagField
        disabled={saving}
        onSelectedTagsChange={handleSelectedTagsChange}
        organizationId={organizationId}
        readOnly={!canEdit}
        selectedTags={selectedTags}
        spaceId={spaceId}
        testId={testId}
        variant={variant}
        trailingElement={
          saving ? (
            <span title={t("saving")}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="sr-only">{t("saving")}</span>
            </span>
          ) : null
        }
      />
      {errorKey ? (
        <span className="text-[11px] text-destructive" role="alert">
          {tRoot(errorKey)}
        </span>
      ) : null}
    </div>
  );
}
