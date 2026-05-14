import type { Organization } from "@project-delivery/shared";

import type {
  AddOrganizationMemberInput,
  CreateOrganizationInput,
  CreatedOrganizationWithOwner,
  OrganizationAccess,
  OrganizationListInput,
  OrganizationListResult,
  OrganizationMemberListInput,
  OrganizationMemberListResult,
  OrganizationSummaryWithRole,
  RemoveOrganizationMemberInput,
  SpaceSummaryWithRole,
  UpdateOrganizationInput,
  UpdateOrganizationMemberInput,
} from "./organization.types";

export const ORGANIZATION_REPOSITORY = Symbol("ORGANIZATION_REPOSITORY");

export type OrganizationRepository = {
  createWithOwner(
    input: CreateOrganizationInput,
  ): Promise<CreatedOrganizationWithOwner>;
  addMember(input: AddOrganizationMemberInput): Promise<
    OrganizationMemberListResult["items"][number]
  >;
  countActiveOwners(organizationId: string): Promise<number>;
  findAccessibleById(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationAccess | undefined>;
  findByCode(code: string): Promise<{ id: string } | undefined>;
  findMemberById(
    organizationId: string,
    memberId: string,
  ): Promise<OrganizationMemberListResult["items"][number] | undefined>;
  findMemberByUserId(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMemberListResult["items"][number] | undefined>;
  listByUserId(
    userId: string,
    input: OrganizationListInput,
  ): Promise<OrganizationListResult>;
  listMembers(
    organizationId: string,
    input: OrganizationMemberListInput,
  ): Promise<OrganizationMemberListResult>;
  listSessionSummaries(userId: string): Promise<OrganizationSummaryWithRole[]>;
  listSessionSpaceSummaries(userId: string): Promise<SpaceSummaryWithRole[]>;
  removeMember(input: RemoveOrganizationMemberInput): Promise<boolean>;
  updateMember(
    input: UpdateOrganizationMemberInput,
  ): Promise<OrganizationMemberListResult["items"][number] | undefined>;
  updateOrganization(
    input: UpdateOrganizationInput,
  ): Promise<Organization | undefined>;
};
