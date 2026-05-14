"use client";

import { Bug, CheckCircle2 } from "lucide-react";

import type { WorkItemViewModel } from "../../lib/v2/mock-data";
import { cn } from "../../lib/utils";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { StatusBadge } from "../ui/status-badge";

const priorityDot: Record<WorkItemViewModel["priority"], string> = {
  LOW: "bg-muted-foreground/40",
  MEDIUM: "bg-info",
  HIGH: "bg-warning",
  URGENT: "bg-destructive",
};

export type WorkItemRowProps = {
  item: WorkItemViewModel;
  onSelect: (item: WorkItemViewModel) => void;
};

export function WorkItemRow({ item, onSelect }: WorkItemRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/40 cursor-pointer"
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          priorityDot[item.priority],
        )}
      />
      {item.type === "BUG" ? (
        <Bug className="h-3.5 w-3.5 shrink-0 text-destructive/80" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary/80" />
      )}
      <span className="font-mono text-[11px] text-muted-foreground">
        {item.code}
      </span>
      <span className="flex-1 truncate text-[13px] font-medium">
        {item.title}
      </span>
      <StatusBadge
        category={item.statusCategory}
        label={item.statusLabel}
        withDot={false}
      />
      {item.versionName && (
        <Badge variant="outline" className="hidden md:inline-flex">
          {item.versionName}
        </Badge>
      )}
      {item.dueDate && (
        <span
          className={cn(
            "hidden text-[11px] md:inline-block",
            item.isOverdue ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {item.dueDate}
        </span>
      )}
      <Avatar className="h-5 w-5 shrink-0">
        <AvatarFallback className="text-[9px]">
          {item.assignee.initial}
        </AvatarFallback>
      </Avatar>
    </button>
  );
}
