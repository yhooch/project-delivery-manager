import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

export type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b border-border px-6 py-4",
        className,
      )}
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <div className="text-[11px] font-medium uppercase tracking-wider text-primary">
              {eyebrow}
            </div>
          )}
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {meta && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {meta}
        </div>
      )}
    </header>
  );
}
