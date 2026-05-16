import type { StatusCategory } from "@project-delivery/shared";
import * as React from "react";

import { cn } from "../../lib/utils";

import { Badge, type BadgeProps } from "./badge";

const statusToVariant: Record<StatusCategory, BadgeProps["variant"]> = {
  NOT_STARTED: "outline",
  IN_PROGRESS: "primary",
  WAITING: "warning",
  VERIFYING: "info",
  DONE: "success",
  TERMINATED: "default",
};

const dotColor: Record<StatusCategory, string> = {
  NOT_STARTED: "bg-muted-foreground/40",
  IN_PROGRESS: "bg-primary",
  WAITING: "bg-warning",
  VERIFYING: "bg-info",
  DONE: "bg-success",
  TERMINATED: "bg-muted-foreground/60",
};

export function getStatusCategoryBadgeVariant(category: StatusCategory) {
  return statusToVariant[category];
}

export function getStatusCategoryDotClass(category: StatusCategory) {
  return dotColor[category];
}

export type StatusBadgeProps = {
  category: StatusCategory;
  label: string;
  withDot?: boolean;
  className?: string;
};

export function StatusBadge({
  category,
  label,
  withDot = true,
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant={getStatusCategoryBadgeVariant(category)}
      className={cn(className)}
    >
      {withDot && (
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            getStatusCategoryDotClass(category),
          )}
        />
      )}
      <span>{label}</span>
    </Badge>
  );
}
