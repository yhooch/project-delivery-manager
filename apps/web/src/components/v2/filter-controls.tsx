"use client";

import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/utils";

type FilterFieldWidth = "sm" | "md" | "lg" | "xl" | "tag";

const filterFieldWidthClass: Record<FilterFieldWidth, string> = {
  sm: "w-full sm:w-[11.5rem]",
  md: "w-full sm:w-[13.5rem]",
  lg: "w-full sm:w-[16rem] lg:w-[18rem]",
  xl: "w-full sm:w-[18rem] lg:w-[22rem]",
  tag: "w-full sm:w-[16rem] lg:w-[18rem]",
};

export function FilterPanel({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/20 px-4 py-3 sm:px-6",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function FilterField({
  children,
  className,
  label,
  width = "md",
}: {
  children: ReactNode;
  className?: string;
  label: ReactNode;
  width?: FilterFieldWidth;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-[11px] font-medium text-muted-foreground",
        filterFieldWidthClass[width],
        className,
      )}
    >
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
