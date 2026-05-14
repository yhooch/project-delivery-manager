import type {
  Organization,
  OrganizationMember,
  OrganizationMemberWithUser,
  OrganizationRole,
  RecordStatus,
  SessionOrganizationSummary,
  SessionSpaceSummary,
} from "@project-delivery/shared";

export type OrganizationSummaryWithRole = SessionOrganizationSummary;
export type SpaceSummaryWithRole = SessionSpaceSummary;

export type CreateOrganizationInput = {
  id: string;
  memberId: string;
  name: string;
  code: string;
  ownerId: string;
};

export type OrganizationListInput = {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

export type OrganizationListResult = {
  items: Organization[];
  total: number;
};

export type OrganizationMemberListInput = {
  page: number;
  pageSize: number;
  role?: OrganizationRole;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: RecordStatus;
};

export type OrganizationMemberListResult = {
  items: OrganizationMemberWithUser[];
  total: number;
};

export type CreatedOrganizationWithOwner = {
  organization: Organization;
  ownerMembership: OrganizationMember;
};

export type OrganizationAccess = {
  organization: Organization;
  role: OrganizationRole;
};

export type AddOrganizationMemberInput = {
  id: string;
  organizationId: string;
  role: OrganizationRole;
  userId: string;
  createdById: string;
};

export type UpdateOrganizationMemberInput = {
  memberId: string;
  organizationId: string;
  role?: OrganizationRole;
  status?: RecordStatus;
  updatedById: string;
};

export type RemoveOrganizationMemberInput = {
  memberId: string;
  organizationId: string;
  removedById: string;
};

export type UpdateOrganizationInput = {
  organizationId: string;
  name?: string;
  code?: string;
  status?: RecordStatus;
  updatedById: string;
};
