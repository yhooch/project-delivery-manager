import type { StatusCategory } from "@project-delivery/shared";

/**
 * Frontend view-model for work items (tasks + bugs).
 * Real API responses `ViewWorkItemSummary | WorkItem | BugView` are mapped to this shape
 * via `toWorkItemViewModel(locale)` for use by list rows, detail drawer, board cards, etc.
 */
export type WorkItemViewModel = {
  id: string;
  code: string;
  type: "TASK" | "BUG";
  title: string;
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

// 评论 / 时间线 / 动作区 Tab 已切换到真实 API（见 TaskDetailSheet），
// 原 MockTimelineEvent / MockComment / MockAction 示例数据已移除。
