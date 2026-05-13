import type {
  DefaultWorkflowCode,
  DefaultWorkflowSummary,
  OrganizationMemberUserSummary,
  RecordStatus,
  Space,
  SpaceMember,
  SpaceMemberWithUser,
  SpaceRole,
  SpaceSummary,
  VersionSummary,
  VersionStatus,
  WorkItemType,
} from "@project-delivery/shared";

const DEFAULT_WORKFLOW_CODES: readonly DefaultWorkflowCode[] = [
  "DEVELOPMENT_TASK",
  "GENERAL_TASK",
  "BUG",
];

type PrismaSpaceRecord = {
  code: string;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  ownerId: string | null;
  staleThresholdDays: number;
  status: "ACTIVE" | "DISABLED";
};

type PrismaSpaceMemberRecord = {
  id: string;
  organizationId: string;
  role: SpaceRole;
  spaceId: string;
  status: "ACTIVE" | "DISABLED";
  userId: string;
};

type PrismaSpaceMemberUserRecord = {
  avatar: string | null;
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  username: string;
};

type PrismaSpaceMemberWithUserRecord = PrismaSpaceMemberRecord & {
  user: PrismaSpaceMemberUserRecord;
};

type PrismaVersionSummaryRecord = {
  bugCount: number;
  blockedCount: number;
  id: string;
  name: string;
  organizationId: string;
  ownerId: string | null;
  releaseDate: Date | null;
  requirementCount: number;
  spaceId: string;
  startDate: Date | null;
  status: VersionStatus;
  target: string | null;
  targetDate: Date | null;
  taskCount: number;
};

type PrismaDefaultWorkflowRecord = {
  isDefault: boolean;
  workItemType: WorkItemType | null;
  workflowDefinition: {
    code: string;
    id: string;
    name: string;
  };
  workflowVersion: {
    _count: {
      actions: number;
      states: number;
    };
    id: string;
    publishedAt: Date | null;
    version: number;
  };
};

export function toSpace(record: PrismaSpaceRecord): Space {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    code: record.code,
    description: record.description ?? undefined,
    ownerId: record.ownerId ?? undefined,
    status: toRecordStatus(record.status),
    settings: {
      staleThresholdDays: record.staleThresholdDays,
    },
  };
}

export function toSpaceSummary(record: PrismaSpaceRecord): SpaceSummary {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    code: record.code,
    description: record.description ?? undefined,
    ownerId: record.ownerId ?? undefined,
    status: toRecordStatus(record.status),
  };
}

export function toSpaceMember(record: PrismaSpaceMemberRecord): SpaceMember {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    userId: record.userId,
    role: record.role,
    status: toRecordStatus(record.status),
  };
}

export function toSpaceMemberWithUser(
  record: PrismaSpaceMemberWithUserRecord,
): SpaceMemberWithUser {
  return {
    ...toSpaceMember(record),
    user: toUserSummary(record.user),
  };
}

export function toVersionSummary(
  record: PrismaVersionSummaryRecord,
): VersionSummary {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    name: record.name,
    target: record.target ?? undefined,
    ownerId: record.ownerId ?? undefined,
    status: record.status,
    startDate: record.startDate?.toISOString(),
    targetDate: record.targetDate?.toISOString(),
    releaseDate: record.releaseDate?.toISOString(),
    stats: {
      requirementCount: record.requirementCount,
      taskCount: record.taskCount,
      bugCount: record.bugCount,
      blockedCount: record.blockedCount,
    },
  };
}

export function toDefaultWorkflowSummary(
  record: PrismaDefaultWorkflowRecord,
): DefaultWorkflowSummary | undefined {
  const code = record.workflowDefinition.code;

  if (!isDefaultWorkflowCode(code) || !record.workItemType) {
    return undefined;
  }

  return {
    workflowId: record.workflowDefinition.id,
    workflowVersionId: record.workflowVersion.id,
    code,
    name: record.workflowDefinition.name,
    workItemType: record.workItemType,
    version: record.workflowVersion.version,
    stateCount: record.workflowVersion._count.states,
    actionCount: record.workflowVersion._count.actions,
    isDefault: record.isDefault,
    publishedAt: record.workflowVersion.publishedAt?.toISOString(),
  };
}

export function isDefaultWorkflowCode(
  value: string,
): value is DefaultWorkflowCode {
  return DEFAULT_WORKFLOW_CODES.includes(value as DefaultWorkflowCode);
}

function toUserSummary(
  record: PrismaSpaceMemberUserRecord,
): OrganizationMemberUserSummary {
  return {
    id: record.id,
    username: record.username,
    name: record.name,
    avatar: record.avatar ?? undefined,
    status: toRecordStatus(record.status),
  };
}

function toRecordStatus(status: "ACTIVE" | "DISABLED"): RecordStatus {
  return status;
}
