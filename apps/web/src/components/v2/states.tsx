"use client";

import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

import { Button } from "../ui/button";

export function LoadingState({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const t = useTranslations("common.states");

  return (
    <div
      className={cn(
        "flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-xs">{label ?? t("loading")}</span>
    </div>
  );
}

export function ErrorState({
  className,
  title,
  message,
  onRetry,
  retryLabel,
}: {
  className?: string;
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const t = useTranslations("common.states");

  return (
    <div
      className={cn(
        "flex h-40 flex-col items-center justify-center gap-2 px-6 text-center",
        className,
      )}
      role="alert"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium text-foreground">
        {title ?? t("errorTitle")}
      </p>
      {message && (
        <p className="max-w-md text-xs text-muted-foreground">{message}</p>
      )}
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-1" onClick={onRetry}>
          {retryLabel ?? t("retry")}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  className,
  icon,
  title,
  description,
  action,
}: {
  className?: string;
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-40 flex-col items-center justify-center gap-2 px-6 text-center",
        className,
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-4 w-4" />}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted/60", className)}
      {...props}
    />
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-border" aria-hidden>
      {Array.from({ length: rows }).map((_, idx) => (
        <li key={idx} className="flex items-center gap-3 px-6 py-2.5">
          <Skeleton className="h-1.5 w-1.5 rounded-full" />
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 flex-1 max-w-md" />
          <Skeleton className="h-5 w-14 rounded" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
