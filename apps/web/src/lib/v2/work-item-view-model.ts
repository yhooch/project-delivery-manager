import type { StatusCategory } from "@project-delivery/shared";

export type WorkItemViewModel = {
  id: string;
  listKey?: string;
  code: string;
  type: "TASK" | "BUG";
  title: string;
  contextLabel?: string;
  statusCategory: StatusCategory;
  statusLabel: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assignee: { name: string; initial: string };
  versionName?: string;
  dueDate?: string;
  isOverdue?: boolean;
  isBlocked?: boolean;
  blockedReason?: string;
  updatedAgo?: string;
};
