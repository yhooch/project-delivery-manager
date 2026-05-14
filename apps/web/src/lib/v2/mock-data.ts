import type { StatusCategory } from "@project-delivery/shared";

/**
 * 前端展示用的工作项视图模型。
 * 真实 API 返回 `ViewWorkItemSummary | WorkItem | BugView` 时通过 `toMockWorkItem(locale)` 转换为该形状供详情抽屉等组件使用。
 * 名称含 "Mock" 是历史原因（最初做切片时用 mock 数据），后续可重命名为 `WorkItemViewModel`。
 */
export type MockWorkItem = {
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
