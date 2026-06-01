"use client";

import { ArrowLeftRight, Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export type DimensionFilterOption = {
  key: string;
  label: string;
};

export type DimensionFilterBucket = {
  active: boolean;
  count: number;
  disabled?: boolean;
  key: string;
  label: string;
  onSelect: () => void;
  testKey?: string;
  title?: string;
};

export type DimensionFilterHeaderProps = {
  activeDimension: string;
  buckets: readonly DimensionFilterBucket[];
  className?: string;
  dimensionAriaLabel: string;
  dimensionLabel: string;
  dimensions: readonly DimensionFilterOption[];
  leadingContent?: ReactNode;
  onDimensionChange: (dimension: string) => void;
  optionTestId?: string;
  testId: string;
};

export function DimensionFilterHeader({
  activeDimension,
  buckets,
  className,
  dimensionAriaLabel,
  dimensionLabel,
  dimensions,
  leadingContent,
  onDimensionChange,
  optionTestId,
  testId,
}: DimensionFilterHeaderProps) {
  const activeDimensionLabel =
    dimensions.find((dimension) => dimension.key === activeDimension)?.label ??
    activeDimension;

  return (
    <div
      className={cn(
        "border-b border-border px-4 py-3 sm:px-6",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
        {leadingContent ? (
          <div className="min-w-0 shrink-0 md:w-[22rem] md:max-w-sm">
            {leadingContent}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <select
            aria-label={dimensionAriaLabel}
            aria-hidden="true"
            data-testid={`${testId}-dimension`}
            tabIndex={-1}
            value={activeDimension}
            onChange={(event) => onDimensionChange(event.target.value)}
            className="sr-only"
          >
            {dimensions.map((dimension) => (
              <option key={dimension.key} value={dimension.key}>
                {dimension.label}
              </option>
            ))}
          </select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={dimensionAriaLabel}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 text-[12px] text-foreground shadow-sm transition-colors cursor-pointer",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                )}
              >
                <ArrowLeftRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-muted-foreground"
                />
                <span className="text-muted-foreground">{dimensionLabel}</span>
                <span className="font-medium">{activeDimensionLabel}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
              {dimensions.map((dimension) => {
                const active = dimension.key === activeDimension;

                return (
                  <DropdownMenuItem
                    key={dimension.key}
                    onSelect={() => onDimensionChange(dimension.key)}
                    className="whitespace-nowrap"
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {dimension.label}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="-mx-1 min-w-0 flex-1 overflow-x-auto px-1">
            <div className="flex min-w-max items-center gap-1">
              {buckets.map((bucket) => (
                <button
                  key={bucket.key}
                  type="button"
                  data-testid={optionTestId ?? `${testId}-option`}
                  data-filter-key={bucket.testKey ?? bucket.key}
                  disabled={bucket.disabled}
                  onClick={bucket.onSelect}
                  title={bucket.title ?? bucket.label}
                  className={cn(
                    "flex h-8 max-w-64 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    bucket.active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                  )}
                >
                  <span className="truncate">{bucket.label}</span>
                  <span className="shrink-0 rounded bg-background px-1 font-mono text-[10px]">
                    {bucket.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
