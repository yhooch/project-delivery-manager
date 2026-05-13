import type {
  Organization,
  OrganizationMember,
  OrganizationMemberUserSummary,
  OrganizationMemberWithUser,
  OrganizationRole,
  RecordStatus,
} from "@project-delivery/shared";

type PrismaOrganizationRecord = {
  code: string;
  id: string;
  name: string;
  ownerId: string | null;
  status: "ACTIVE" | "DISABLED";
};

type PrismaOrganizationMemberRecord = {
  id: string;
  organizationId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "DISABLED";
  userId: string;
};

type PrismaOrganizationMemberUserRecord = {
  avatar: string | null;
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  username: string;
};

type PrismaOrganizationMemberWithUserRecord = PrismaOrganizationMemberRecord & {
  user: PrismaOrganizationMemberUserRecord;
};

export function toOrganization(record: PrismaOrganizationRecord): Organization {
  return {
    id: record.id,
    name: record.name,
    code: record.code,
    ownerId: record.ownerId ?? undefined,
    status: toRecordStatus(record.status),
  };
}

export function toOrganizationMember(
  record: PrismaOrganizationMemberRecord,
): OrganizationMember {
  return {
    id: record.id,
    organizationId: record.organizationId,
    userId: record.userId,
    role: toOrganizationRole(record.role),
    status: toRecordStatus(record.status),
  };
}

export function toOrganizationMemberUserSummary(
  record: PrismaOrganizationMemberUserRecord,
): OrganizationMemberUserSummary {
  return {
    id: record.id,
    username: record.username,
    name: record.name,
    avatar: record.avatar ?? undefined,
    status: toRecordStatus(record.status),
  };
}

export function toOrganizationMemberWithUser(
  record: PrismaOrganizationMemberWithUserRecord,
): OrganizationMemberWithUser {
  return {
    ...toOrganizationMember(record),
    user: toOrganizationMemberUserSummary(record.user),
  };
}

export function toOrganizationRole(
  role: "OWNER" | "ADMIN" | "MEMBER",
): OrganizationRole {
  return role;
}

function toRecordStatus(status: "ACTIVE" | "DISABLED"): RecordStatus {
  return status;
}
