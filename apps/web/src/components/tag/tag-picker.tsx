"use client";

import type { TagDto } from "@project-delivery/shared";
import { Check, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  createTag,
  listTags,
  type CreateTagInput,
  type ListTagsInput,
} from "../../lib/tag-service";
import { cn } from "../../lib/utils";
import {
  formatApiErrorDisplayMessage,
  getApiErrorDetailLines,
} from "../shell/api-error-display";
import { Input } from "../ui/input";

import { TagBadge, formatTagDisplayName } from "./tag-badge";

export type TagPickerListTags = (
  input: ListTagsInput,
) => Promise<{ items: TagDto[] }>;

export type TagPickerCreateTag = (
  context: { organizationId?: string; spaceId: string },
  input: CreateTagInput,
) => Promise<TagDto>;

export type TagPickerProps = {
  allowCreate?: boolean;
  autoFocus?: boolean;
  className?: string;
  createTagAction?: TagPickerCreateTag;
  disabled?: boolean;
  excludeTagIds?: readonly string[];
  inputClassName?: string;
  inputId?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  listTagsAction?: TagPickerListTags;
  onEmptyBackspace?: () => void;
  onSelect: (tag: TagDto) => void | Promise<void>;
  organizationId?: string;
  pageSize?: number;
  panelClassName?: string;
  panelMaxHeightClassName?: string;
  panelPlacement?: "bottom" | "top";
  placeholder?: string;
  readOnly?: boolean;
  selectedTags?: readonly TagDto[];
  spaceId: string;
  variant?: "standalone" | "embedded";
  "data-testid"?: string;
};

const DEFAULT_PAGE_SIZE = 20;

export function TagPicker({
  allowCreate = true,
  autoFocus,
  className,
  createTagAction = createTag,
  disabled = false,
  excludeTagIds = [],
  inputClassName,
  inputId,
  inputRef,
  listTagsAction = listTags,
  onEmptyBackspace,
  onSelect,
  organizationId,
  pageSize = DEFAULT_PAGE_SIZE,
  panelClassName,
  panelMaxHeightClassName,
  panelPlacement = "bottom",
  placeholder,
  readOnly = false,
  selectedTags = [],
  spaceId,
  variant = "standalone",
  "data-testid": testId,
}: TagPickerProps) {
  const t = useTranslations("tags.picker");
  const tRoot = useTranslations();
  const requestIdLabel = tRoot("errors.apiDetails.requestId");
  const listErrorMessage = t("error");
  const createErrorMessage = t("createError");
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const requestIdRef = React.useRef(0);
  const listboxId = React.useId();
  const [inputValue, setInputValue] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<TagDto[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const isInteractive = !disabled && !readOnly;
  const searchTerm = normalizeTagInput(inputValue);
  const excludedIds = React.useMemo(
    () => new Set([...excludeTagIds, ...selectedTags.map((tag) => tag.id)]),
    [excludeTagIds, selectedTags],
  );
  const visibleItems = React.useMemo(
    () => items.filter((item) => !excludedIds.has(item.id)),
    [excludedIds, items],
  );
  const exactMatch = visibleItems.some((item) =>
    isSameTagName(item, searchTerm),
  );
  const canCreate =
    allowCreate && isInteractive && searchTerm.length > 0 && !exactMatch;
  const showPanel = open && isInteractive;

  React.useEffect(() => {
    if (!showPanel || !spaceId) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);

    void listTagsAction({
      includeUsage: true,
      organizationId,
      page: 1,
      pageSize,
      query: searchTerm || undefined,
      spaceId,
    })
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setItems(result.items);
        }
      })
      .catch((error) => {
        if (requestIdRef.current === requestId) {
          setItems([]);
          setErrorMessage(
            formatTagPickerErrorMessage(
              listErrorMessage,
              error,
              requestIdLabel,
            ),
          );
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      });
  }, [
    listTagsAction,
    listErrorMessage,
    organizationId,
    pageSize,
    requestIdLabel,
    searchTerm,
    showPanel,
    spaceId,
  ]);

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (!rootRef.current?.contains(event.relatedTarget)) {
      setOpen(false);
    }
  }

  async function handleSelect(tag: TagDto) {
    if (!isInteractive) {
      return;
    }

    await onSelect(tag);
    setInputValue("");
    setOpen(false);
  }

  async function handleCreate() {
    if (!canCreate || isCreating) {
      return;
    }

    setIsCreating(true);
    setErrorMessage(null);
    try {
      const tag = await createTagAction(
        { organizationId, spaceId },
        { name: searchTerm },
      );
      await onSelect(tag);
      setInputValue("");
      setOpen(false);
    } catch (error) {
      setErrorMessage(
        formatTagPickerErrorMessage(createErrorMessage, error, requestIdLabel),
      );
    } finally {
      setIsCreating(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isInteractive) {
      return;
    }

    if (event.key === "Backspace" && inputValue.length === 0) {
      onEmptyBackspace?.();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    const firstExactMatch = visibleItems.find((item) =>
      isSameTagName(item, searchTerm),
    );
    const firstItem = firstExactMatch ?? visibleItems[0];

    if (firstExactMatch || (!canCreate && firstItem)) {
      event.preventDefault();
      void handleSelect(firstItem);
      return;
    }

    if (canCreate) {
      event.preventDefault();
      void handleCreate();
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn("relative min-w-0", className)}
      onBlur={handleBlur}
      data-testid={testId}
    >
      <Input
        id={inputId}
        ref={inputRef}
        value={inputValue}
        autoFocus={autoFocus}
        disabled={disabled}
        readOnly={readOnly}
        aria-readonly={readOnly || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showPanel}
        aria-controls={showPanel ? listboxId : undefined}
        placeholder={placeholder ?? t("placeholder")}
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(event) => {
          setInputValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (isInteractive) {
            setOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          variant === "embedded"
            ? "h-7 min-w-[9rem] border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 [@media(pointer:coarse)]:min-h-7 [@media(pointer:coarse)]:py-0"
            : "pr-8",
          inputClassName,
        )}
      />
      {(isLoading || isCreating) && (
        <Loader2
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute h-4 w-4 animate-spin text-muted-foreground",
            variant === "embedded" ? "right-0 top-1.5" : "right-2.5 top-2",
          )}
        />
      )}
      {showPanel && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("resultsLabel")}
          className={cn(
            "absolute z-30 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg",
            panelPlacement === "top" ? "bottom-full mb-1" : "top-full mt-1",
            "left-0",
            panelMaxHeightClassName ?? "max-h-72",
            variant === "embedded" ? "min-w-64" : "w-full",
            panelClassName,
          )}
          data-testid={testId ? `${testId}-panel` : undefined}
        >
          {errorMessage ? (
            <TagPickerMessage>{errorMessage}</TagPickerMessage>
          ) : isLoading && visibleItems.length === 0 ? (
            <TagPickerMessage>{t("loading")}</TagPickerMessage>
          ) : (
            <>
              {visibleItems.map((tag) => (
                <TagPickerOption
                  key={tag.id}
                  tag={tag}
                  onSelect={() => void handleSelect(tag)}
                />
              ))}
              {canCreate && (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  disabled={isCreating}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleCreate()}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
                    "hover:bg-muted focus:bg-muted focus:text-foreground",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {t("create", { name: `#${searchTerm}` })}
                  </span>
                </button>
              )}
              {!isLoading && visibleItems.length === 0 && !canCreate && (
                <TagPickerMessage>{t("empty")}</TagPickerMessage>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TagPickerOption({
  onSelect,
  tag,
}: {
  onSelect: () => void;
  tag: TagDto;
}) {
  const t = useTranslations("tags.picker");

  return (
    <button
      type="button"
      role="option"
      aria-selected="false"
      aria-label={t("select", { name: formatTagDisplayName(tag) })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
        "hover:bg-muted focus:bg-muted focus:text-foreground",
      )}
    >
      <Check aria-hidden="true" className="h-4 w-4 shrink-0 opacity-0" />
      <TagBadge tag={tag} />
      {typeof tag.usageCount === "number" && (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {tag.usageCount}
        </span>
      )}
    </button>
  );
}

function TagPickerMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-3 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function formatTagPickerErrorMessage(
  message: string,
  error: unknown,
  requestIdLabel: string,
): string {
  return formatApiErrorDisplayMessage(
    message,
    getApiErrorDetailLines(error, requestIdLabel),
    " · ",
  );
}

export function normalizeTagInput(value: string) {
  const trimmed = value.trim();
  return (trimmed.startsWith("#") ? trimmed.slice(1) : trimmed).trim();
}

function isSameTagName(tag: TagDto, value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    tag.name.toLowerCase() === normalized ||
    tag.displayName.slice(1).toLowerCase() === normalized ||
    tag.normalizedName.toLowerCase() === normalized
  );
}
