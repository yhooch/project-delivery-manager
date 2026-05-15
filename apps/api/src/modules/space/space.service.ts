import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  type AddSpaceMemberRequest,
  type CreateSpaceRequest,
  type GetMyWorkbenchViewResponse,
  type GetSpaceExceptionsViewResponse,
  type GetSpaceOverviewViewResponse,
  type PageResult,
  type Space,
  type SpaceMemberWithUser,
  type SpaceExceptionsViewQuery,
  type SpaceOverviewViewQuery,
  type SpaceRole,
  type SpaceSummary,
  type UpdateSpaceMemberRequest,
  type UpdateSpaceRequest,
  type WorkbenchViewQuery,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import {
  USER_REPOSITORY,
  type UserRepository,
} from "../identity/identity.repository";
import type { IdentityUser } from "../identity/identity.types";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import { WorkflowDefaultInitializerService } from "../workflow/workflow-default-initializer.service";
import { SPACE_REPOSITORY, type SpaceRepository } from "./space.repository";
import type { SpaceListInput, SpaceMemberListInput } from "./space.types";

const DEFAULT_STALE_THRESHOLD_DAYS = 3;
const SPACE_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);

@Injectable()
export class SpaceService {
  constructor(
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(WorkflowDefaultInitializerService)
    private readonly workflowInitializer: WorkflowDefaultInitializerService,
    @Inject(AuditService)
    private readonly audit: AuditService,
  ) {}

  async list(
    actorUserId: string,
    organizationId: string,
    input: SpaceListInput,
  ): Promise<PageResult<SpaceSummary>> {
    const access = await this.requireOrganizationAccess(
      actorUserId,
      organizationId,
    );
    const canListAllSpaces = access.role === "OWNER" || access.role === "ADMIN";
    const result = await this.spaces.listByOrganizationId(
      organizationId,
      input,
      canListAllSpaces ? undefined : actorUserId,
    );

    return {
      items: result.items,
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }

  async create(
    actorUserId: string,
    organizationId: string,
    input: CreateSpaceRequest,
    metadata: RequestMetadata = {},
  ): Promise<Space> {
    await this.requireOrganizationManager(actorUserId, organizationId);
    const ownerId = input.ownerId ?? actorUserId;
    await this.requireActiveOrganizationMember(organizationId, ownerId);

    const code = input.code ?? generateSpaceCode(input.name);
    const existing = await this.spaces.findByCode(organizationId, code);

    if (existing) {
      throw new ApiException(
        "CONFLICT",
        "Space code already exists in organization",
        HttpStatus.CONFLICT,
      );
    }

    const created = await this.spaces.createWithAdmin({
      id: ulid(),
      adminMemberId: ulid(),
      ownerMemberId: ownerId === actorUserId ? undefined : ulid(),
      organizationId,
      name: input.name,
      code,
      description: input.description,
      ownerId,
      staleThresholdDays:
        input.staleThresholdDays ?? DEFAULT_STALE_THRESHOLD_DAYS,
      actorUserId,
    });

    await this.workflowInitializer.initializeDefaultWorkflowsForSpace({
      actorUserId,
      organizationId,
      spaceId: created.space.id,
    });
    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created.space,
      ...metadata,
      organizationId,
      spaceId: created.space.id,
      targetId: created.space.id,
      targetType: "SPACE",
    });

    return created.space;
  }

  async get(actorUserId: string, spaceId: string): Promise<Space> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    return access.space;
  }

  async update(
    actorUserId: string,
    spaceId: string,
    input: UpdateSpaceRequest,
    metadata: RequestMetadata = {},
  ): Promise<Space> {
    const access = await this.requireSpaceManager(actorUserId, spaceId);

    if (input.ownerId) {
      await this.requireActiveOrganizationMember(
        access.space.organizationId,
        input.ownerId,
      );
    }

    if (input.code && input.code !== access.space.code) {
      const existing = await this.spaces.findByCode(
        access.space.organizationId,
        input.code,
      );

      if (existing && existing.id !== access.space.id) {
        throw new ApiException(
          "CONFLICT",
          "Space code already exists in organization",
          HttpStatus.CONFLICT,
        );
      }
    }

    const updated = await this.spaces.update({
      spaceId,
      name: input.name,
      code: input.code,
      description: input.description,
      ownerId: input.ownerId,
      status: input.status,
      staleThresholdDays: input.staleThresholdDays,
      updatedById: actorUserId,
    });

    if (!updated) {
      throwSpaceNotFound();
    }

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: updated,
      before: access.space,
      ...metadata,
      organizationId: access.space.organizationId,
      spaceId,
      targetId: spaceId,
      targetType: "SPACE",
    });

    return updated;
  }

  async listMembers(
    actorUserId: string,
    spaceId: string,
    input: SpaceMemberListInput,
  ): Promise<PageResult<SpaceMemberWithUser>> {
    await this.requireSpaceAccess(actorUserId, spaceId);

    return this.spaces.listMembers(spaceId, input);
  }

  async addMember(
    actorUserId: string,
    spaceId: string,
    input: AddSpaceMemberRequest,
    metadata: RequestMetadata = {},
  ): Promise<SpaceMemberWithUser> {
    const access = await this.requireSpaceManager(actorUserId, spaceId);
    const user = await this.resolveActiveUser(input);
    await this.requireActiveOrganizationMember(
      access.space.organizationId,
      user.id,
    );

    const existingMember = await this.spaces.findMemberByUserId(
      spaceId,
      user.id,
    );

    if (existingMember) {
      throw new ApiException(
        "CONFLICT",
        "Space member already exists",
        HttpStatus.CONFLICT,
      );
    }

    const added = await this.spaces.addMember({
      id: ulid(),
      organizationId: access.space.organizationId,
      spaceId,
      userId: user.id,
      role: input.role,
      createdById: actorUserId,
    });
    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: summarizeSpaceMember(added),
      ...metadata,
      organizationId: access.space.organizationId,
      spaceId,
      targetId: added.id,
      targetType: "SPACE_MEMBER",
    });

    return added;
  }

  async updateMember(
    actorUserId: string,
    spaceId: string,
    memberId: string,
    input: UpdateSpaceMemberRequest,
    metadata: RequestMetadata = {},
  ): Promise<SpaceMemberWithUser> {
    const access = await this.requireSpaceManager(actorUserId, spaceId);
    const member = await this.spaces.findMemberById(spaceId, memberId);

    if (!member) {
      throwSpaceMemberNotFound();
    }

    const updated = await this.spaces.updateMember({
      memberId,
      spaceId,
      role: input.role,
      status: input.status,
      updatedById: actorUserId,
    });

    if (!updated) {
      throwSpaceMemberNotFound();
    }

    await this.audit.record({
      actionType: hasRoleOrStatusChange(member, updated)
        ? "ROLE_CHANGED"
        : "UPDATE",
      actorId: actorUserId,
      after: summarizeSpaceMember(updated),
      before: summarizeSpaceMember(member),
      ...metadata,
      organizationId: access.space.organizationId,
      spaceId,
      targetId: updated.id,
      targetType: "SPACE_MEMBER",
    });

    return updated;
  }

  async getOverview(
    actorUserId: string,
    spaceId: string,
    query: SpaceOverviewViewQuery = {},
  ): Promise<GetSpaceOverviewViewResponse> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    if (
      query.organizationId &&
      query.organizationId !== access.space.organizationId
    ) {
      throwSpaceAccessDenied();
    }

    return this.spaces.getSpaceOverviewView({
      actorUserId,
      role: access.role,
      space: access.space,
      versionId: query.versionId,
    });
  }

  async getExceptions(
    actorUserId: string,
    spaceId: string,
    query: SpaceExceptionsViewQuery,
  ): Promise<GetSpaceExceptionsViewResponse> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    if (
      query.organizationId &&
      query.organizationId !== access.space.organizationId
    ) {
      throwSpaceAccessDenied();
    }

    return this.spaces.getSpaceExceptionsView({
      actorUserId,
      role: access.role,
      space: access.space,
      page: query.page,
      pageSize: query.pageSize,
      versionId: query.versionId,
      assigneeId: query.assigneeId,
      statusCategory: query.statusCategory,
      workItemType: query.workItemType,
      exceptionType: query.exceptionType,
    });
  }

  async getMyWorkbench(
    actorUserId: string,
    query: WorkbenchViewQuery,
  ): Promise<GetMyWorkbenchViewResponse> {
    if (!query.organizationId) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "organizationId is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.requireOrganizationAccess(actorUserId, query.organizationId);

    if (query.spaceId) {
      const access = await this.requireSpaceAccess(actorUserId, query.spaceId);

      if (access.space.organizationId !== query.organizationId) {
        throwSpaceAccessDenied();
      }
    }

    return this.spaces.getMyWorkbenchView({
      actorUserId,
      assigneeId: query.assigneeId,
      exceptionType: query.exceptionType,
      organizationId: query.organizationId,
      page: query.page,
      pageSize: query.pageSize,
      spaceId: query.spaceId,
      statusCategory: query.statusCategory,
      versionId: query.versionId,
      workItemType: query.workItemType,
    });
  }

  private async requireOrganizationAccess(
    userId: string,
    organizationId: string,
  ) {
    const access = await this.organizations.findAccessibleById(
      userId,
      organizationId,
    );

    if (!access) {
      throwOrganizationAccessDenied();
    }

    return access;
  }

  private async requireOrganizationManager(
    userId: string,
    organizationId: string,
  ) {
    const access = await this.requireOrganizationAccess(userId, organizationId);

    if (access.role !== "OWNER" && access.role !== "ADMIN") {
      throwOrganizationAccessDenied();
    }

    return access;
  }

  private async requireSpaceAccess(userId: string, spaceId: string) {
    const access = await this.spaces.findAccessibleById(userId, spaceId);

    if (!access) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireSpaceManager(userId: string, spaceId: string) {
    const access = await this.requireSpaceAccess(userId, spaceId);

    if (!SPACE_MANAGER_ROLES.has(access.role)) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireActiveOrganizationMember(
    organizationId: string,
    userId: string,
  ) {
    const member = await this.organizations.findMemberByUserId(
      organizationId,
      userId,
    );

    if (!member || member.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_MUST_BELONG_TO_ORGANIZATION",
        "Space member must belong to the same organization",
        HttpStatus.BAD_REQUEST,
      );
    }

    return member;
  }

  private async resolveActiveUser(
    input: AddSpaceMemberRequest,
  ): Promise<IdentityUser> {
    const userById = input.userId
      ? await this.users.findById(input.userId)
      : undefined;
    const userByUsername = input.username
      ? await this.users.findByUsername(normalizeUsername(input.username))
      : undefined;

    if (userById && userByUsername && userById.id !== userByUsername.id) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "username and userId refer to different users",
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = userById ?? userByUsername;

    if (!user || user.status !== "ACTIVE") {
      throw new ApiException(
        "NOT_FOUND",
        "User not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return user;
  }
}

function generateSpaceCode(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 20);
  const base = normalized.length >= 2 ? normalized : "space";

  return `${base}-${ulid().slice(0, 8).toLowerCase()}`.slice(0, 32);
}

function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

function hasRoleOrStatusChange(
  before: SpaceMemberWithUser,
  after: SpaceMemberWithUser,
): boolean {
  return before.role !== after.role || before.status !== after.status;
}

function summarizeSpaceMember(member: SpaceMemberWithUser) {
  return {
    id: member.id,
    role: member.role,
    status: member.status,
    userId: member.userId,
  };
}

function throwOrganizationAccessDenied(): never {
  throw new ApiException(
    "ORGANIZATION_ACCESS_DENIED",
    "Organization access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwSpaceNotFound(): never {
  throw new ApiException(
    "SPACE_NOT_FOUND",
    "Space not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwSpaceMemberNotFound(): never {
  throw new ApiException(
    "SPACE_MEMBER_NOT_FOUND",
    "Space member not found",
    HttpStatus.NOT_FOUND,
  );
}
