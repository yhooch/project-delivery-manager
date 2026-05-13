import type {
  DefaultWorkflowSummary,
  Space,
  SpaceMemberWithUser,
  SpaceOverviewStats,
  VersionSummary,
} from "@project-delivery/shared";

import type {
  AddSpaceMemberInput,
  CreateSpaceInput,
  CreatedSpaceWithAdmin,
  SpaceAccess,
  SpaceListInput,
  SpaceListResult,
  SpaceMemberListInput,
  SpaceMemberListResult,
  UpdateSpaceInput,
  UpdateSpaceMemberInput,
} from "./space.types";

export const SPACE_REPOSITORY = Symbol("SPACE_REPOSITORY");

export type SpaceRepository = {
  addMember(input: AddSpaceMemberInput): Promise<SpaceMemberWithUser>;
  createWithAdmin(input: CreateSpaceInput): Promise<CreatedSpaceWithAdmin>;
  findAccessibleById(
    userId: string,
    spaceId: string,
  ): Promise<SpaceAccess | undefined>;
  findByCode(
    organizationId: string,
    code: string,
  ): Promise<{ id: string } | undefined>;
  findMemberById(
    spaceId: string,
    memberId: string,
  ): Promise<SpaceMemberWithUser | undefined>;
  findMemberByUserId(
    spaceId: string,
    userId: string,
  ): Promise<SpaceMemberWithUser | undefined>;
  getOverviewStats(spaceId: string): Promise<SpaceOverviewStats>;
  findCurrentVersion(spaceId: string): Promise<VersionSummary | undefined>;
  listByOrganizationId(
    organizationId: string,
    input: SpaceListInput,
    accessibleByUserId?: string,
  ): Promise<SpaceListResult>;
  listDefaultWorkflows(spaceId: string): Promise<DefaultWorkflowSummary[]>;
  listMembers(
    spaceId: string,
    input: SpaceMemberListInput,
  ): Promise<SpaceMemberListResult>;
  update(input: UpdateSpaceInput): Promise<Space | undefined>;
  updateMember(
    input: UpdateSpaceMemberInput,
  ): Promise<SpaceMemberWithUser | undefined>;
};
