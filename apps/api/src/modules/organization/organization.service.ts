import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  type AddOrganizationMemberRequest,
  type CreateOrganizationRequest,
  type Organization,
  type OrganizationMemberWithUser,
  type PageResult,
  type RecordStatus,
  type UpdateOrganizationMemberRequest,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { RateLimiterService } from "../auth/rate-limiter.service";
import {
  USER_REPOSITORY,
  type UserRepository,
} from "../identity/identity.repository";
import type { IdentityUser } from "../identity/identity.types";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "./organization.repository";
import type { OrganizationMemberListInput } from "./organization.types";

const CREATE_ORGANIZATION_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(RateLimiterService)
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async create(
    userId: string,
    input: CreateOrganizationRequest,
  ): Promise<Organization> {
    const limiter = {
      key: `organization:create:${userId}`,
      limit: CREATE_ORGANIZATION_LIMIT,
      windowMs: RATE_LIMIT_WINDOW_MS,
    };
    this.rateLimiter.assertAllowed(limiter);
    this.rateLimiter.record(limiter);

    const code = input.code ?? generateOrganizationCode(input.name);
    const existing = await this.organizations.findByCode(code);

    if (existing) {
      throw new ApiException(
        "CONFLICT",
        "Organization code already exists",
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.organizations.createWithOwner({
      id: ulid(),
      memberId: ulid(),
      name: input.name,
      code,
      ownerId: userId,
    });

    return result.organization;
  }

  async list(
    userId: string,
    input: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    },
  ): Promise<PageResult<Organization>> {
    const result = await this.organizations.listByUserId(userId, input);

    return {
      items: result.items,
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }

  async get(userId: string, organizationId: string): Promise<Organization> {
    const access = await this.organizations.findAccessibleById(
      userId,
      organizationId,
    );

    if (!access) {
      throw new ApiException(
        "ORGANIZATION_ACCESS_DENIED",
        "Organization access denied",
        HttpStatus.FORBIDDEN,
      );
    }

    return access.organization;
  }

  async listMembers(
    userId: string,
    organizationId: string,
    input: OrganizationMemberListInput,
  ): Promise<PageResult<OrganizationMemberWithUser>> {
    await this.requireOrganizationAccess(userId, organizationId);

    const result = await this.organizations.listMembers(organizationId, input);

    return {
      items: result.items,
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }

  async addMember(
    actorUserId: string,
    organizationId: string,
    input: AddOrganizationMemberRequest,
  ): Promise<OrganizationMemberWithUser> {
    await this.requireOrganizationManager(actorUserId, organizationId);

    const user = await this.resolveActiveUser(input);
    const existingMember = await this.organizations.findMemberByUserId(
      organizationId,
      user.id,
    );

    if (existingMember) {
      throw new ApiException(
        "CONFLICT",
        "Organization member already exists",
        HttpStatus.CONFLICT,
      );
    }

    return this.organizations.addMember({
      id: ulid(),
      organizationId,
      role: input.role,
      userId: user.id,
      createdById: actorUserId,
    });
  }

  async updateMember(
    actorUserId: string,
    organizationId: string,
    memberId: string,
    input: UpdateOrganizationMemberRequest,
  ): Promise<OrganizationMemberWithUser> {
    await this.requireOrganizationManager(actorUserId, organizationId);

    const member = await this.organizations.findMemberById(
      organizationId,
      memberId,
    );

    if (!member) {
      throw new ApiException(
        "ORGANIZATION_MEMBER_NOT_FOUND",
        "Organization member not found",
        HttpStatus.NOT_FOUND,
      );
    }

    await this.assertLastOwnerRemains(member, input);

    const updated = await this.organizations.updateMember({
      memberId,
      organizationId,
      role: input.role,
      status: input.status,
      updatedById: actorUserId,
    });

    if (!updated) {
      throw new ApiException(
        "ORGANIZATION_MEMBER_NOT_FOUND",
        "Organization member not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return updated;
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

  private async resolveActiveUser(
    input: AddOrganizationMemberRequest,
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
      throw new ApiException("NOT_FOUND", "User not found", HttpStatus.NOT_FOUND);
    }

    return user;
  }

  private async assertLastOwnerRemains(
    currentMember: OrganizationMemberWithUser,
    input: UpdateOrganizationMemberRequest,
  ): Promise<void> {
    if (!isEffectiveOwner(currentMember)) {
      return;
    }

    const nextRole = input.role ?? currentMember.role;
    const nextStatus = input.status ?? currentMember.status;

    if (nextRole === "OWNER" && nextStatus === "ACTIVE") {
      return;
    }

    const activeOwnerCount = await this.organizations.countActiveOwners(
      currentMember.organizationId,
    );

    if (activeOwnerCount <= 1) {
      throw new ApiException(
        "LAST_ORGANIZATION_OWNER_REQUIRED",
        "At least one active organization OWNER is required",
        HttpStatus.CONFLICT,
      );
    }
  }
}

function generateOrganizationCode(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 20);
  const base = normalized.length >= 2 ? normalized : "org";

  return `${base}-${ulid().slice(0, 8).toLowerCase()}`.slice(0, 32);
}

function isEffectiveOwner(member: {
  role: string;
  status: RecordStatus;
}): boolean {
  return member.role === "OWNER" && member.status === "ACTIVE";
}

function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

function throwOrganizationAccessDenied(): never {
  throw new ApiException(
    "ORGANIZATION_ACCESS_DENIED",
    "Organization access denied",
    HttpStatus.FORBIDDEN,
  );
}
