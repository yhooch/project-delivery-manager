import type {
  PermissionSnapshot,
  Priority,
  StatusCategory,
  WorkItem,
  WorkItemDetail,
  WorkItemType,
} from "@project-delivery/shared";

type PrismaWorkItemRecord = {
  id: string;
  type: WorkItemType;
  organizationId: string;
  spaceId: string;
  versionId: string | null;
  requirementId: string | null;
  intakeItemId: string | null;
  title: string;
  description: string | null;
  priority: Priority;
  assigneeId: string | null;
  reporterId: string;
  workflowVersionId: string;
  currentStateId: string;
  statusCategory: StatusCategory;
  dueDate: Date | null;
  lastStatusChangedAt: Date;
  lastActionAt: Date | null;
  blockedReason: string | null;
  blockedAt: Date | null;
};

export function toWorkItem(
  record: PrismaWorkItemRecord,
  permissions?: PermissionSnapshot,
): WorkItem {
  return {
    id: record.id,
    type: record.type,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    versionId: record.versionId ?? undefined,
    requirementId: record.requirementId ?? undefined,
    intakeItemId: record.intakeItemId ?? undefined,
    title: record.title,
    description: record.description ?? undefined,
    priority: record.priority,
    assigneeId: record.assigneeId ?? undefined,
    reporterId: record.reporterId,
    workflowVersionId: record.workflowVersionId,
    currentStateId: record.currentStateId,
    statusCategory: record.statusCategory,
    dueDate: record.dueDate?.toISOString(),
    lastStatusChangedAt: record.lastStatusChangedAt.toISOString(),
    lastActionAt: record.lastActionAt?.toISOString(),
    blockedReason: record.blockedReason ?? undefined,
    blockedAt: record.blockedAt?.toISOString(),
    permissions,
  };
}

export function toWorkItemDetail(
  record: WorkItem,
  permissions: PermissionSnapshot,
): WorkItemDetail {
  return {
    id: record.id,
    type: record.type,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    versionId: record.versionId,
    requirementId: record.requirementId,
    intakeItemId: record.intakeItemId,
    title: record.title,
    description: record.description,
    priority: record.priority,
    assigneeId: record.assigneeId,
    reporterId: record.reporterId,
    workflowVersionId: record.workflowVersionId,
    currentStateId: record.currentStateId,
    statusCategory: record.statusCategory,
    dueDate: record.dueDate,
    lastStatusChangedAt: record.lastStatusChangedAt,
    lastActionAt: record.lastActionAt,
    blockedReason: record.blockedReason,
    blockedAt: record.blockedAt,
    permissions,
  };
}
