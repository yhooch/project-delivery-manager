import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  type CreateVersionRequest,
  type GetVersionBoardViewResponse,
  type PageResult,
  type SpaceRole,
  type UpdateVersionRequest,
  type Version,
  type VersionBoardViewQuery,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { auditAccessDenied } from "../audit/audit-access-denied";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import {
  VERSION_REPOSITORY,
  type VersionRepository,
} from "./version.repository";
import type {
  VersionBoardVisibility,
  VersionListInput,
  VersionStatsVisibility,
} from "./version.types";
import { canReadAllSpaceWorkItems } from "../workitem/workitem-visibility";

const SPACE_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);
const REQUIREMENT_STATS_READ_ALL_ROLES = new Set<SpaceRole>(["REQUIREMENT"]);

type RequirementStatsVisibility = "SPACE";

type WithRequirementStatsVisibility<T> = T & {
  requirementStatsVisibility?: RequirementStatsVisibility;
};

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);

  constructor(
    @Inject(VERSION_REPOSITORY)
    private readonly versions: VersionRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: Omit<VersionListInput, "actorUserId" | "visibility">,
  ): Promise<PageResult<Version>> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    return this.versions.listBySpaceId(
      spaceId,
      withRequirementStatsVisibility(
        {
          ...input,
          actorUserId,
          visibility: resolveVersionStatsVisibility(access.role),
        },
        access.role,
      ),
    );
  }

  async create(
    actorUserId: string,
    spaceId: string,
    input: CreateVersionRequest,
    metadata: RequestMetadata = {},
  ): Promise<Version> {
    const access = await this.requireSpaceManager(actorUserId, spaceId, {
      metadata,
      operation: "createVersion",
      targetId: spaceId,
      targetType: "SPACE",
    });

    await this.assertUniqueName(spaceId, input.name);
    if (input.ownerId) {
      await this.requireActiveSpaceOwner(
        access.space.organizationId,
        spaceId,
        input.ownerId,
      );
    }

    const created = await this.versions.create({
      id: ulid(),
      organizationId: access.space.organizationId,
      spaceId,
      name: input.name,
      target: input.target,
      description: input.description,
      ownerId: input.ownerId,
      status: input.status,
      startDate: parseOptionalDate(input.startDate, "startDate"),
      targetDate: parseOptionalDate(input.targetDate, "targetDate"),
      releaseDate: parseOptionalDate(input.releaseDate, "releaseDate"),
      createdById: actorUserId,
    });

    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created,
      ...metadata,
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetId: created.id,
      targetType: "VERSION",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      target: { type: "VERSION", id: created.id },
      operation: "CREATED",
      invalidates: ["version-board", "space-overview"],
      hints: {
        targetType: "VERSION",
        targetId: created.id,
        spaceId: created.spaceId,
        versionId: created.id,
      },
    });

    return created;
  }

  async get(actorUserId: string, versionId: string): Promise<Version> {
    const version = await this.versions.findById(versionId);

    if (!version) {
      throwVersionNotFound();
    }

    const access = await this.requireSpaceAccess(actorUserId, version.spaceId);

    return this.withVisibleStats(version, actorUserId, access.role);
  }

  async getBoard(
    actorUserId: string,
    versionId: string,
    input: VersionBoardViewQuery,
  ): Promise<GetVersionBoardViewResponse> {
    const version = await this.versions.findById(versionId);

    if (!version) {
      throwVersionNotFound();
    }

    this.assertBoardScope(version, input);
    const access = await this.requireSpaceAccess(actorUserId, version.spaceId);
    const board = await this.versions.listBoard({
      ...input,
      actorUserId,
      organizationId: version.organizationId,
      spaceId: version.spaceId,
      staleThresholdDays: access.space.settings.staleThresholdDays,
      versionId,
      visibility: resolveVersionBoardVisibility(access.role),
    });

    return {
      filters: {
        assigneeId: input.assigneeId,
        organizationId: version.organizationId,
        spaceId: version.spaceId,
        statusCategory: input.statusCategory,
        versionId,
        workItemType: input.workItemType,
      },
      ...board,
    };
  }

  async update(
    actorUserId: string,
    versionId: string,
    input: UpdateVersionRequest,
    metadata: RequestMetadata = {},
  ): Promise<Version> {
    const existing = await this.versions.findById(versionId);

    if (!existing) {
      throwVersionNotFound();
    }

    const access = await this.requireSpaceManager(
      actorUserId,
      existing.spaceId,
      {
        metadata,
        operation: "updateVersion",
        targetId: versionId,
        targetType: "VERSION",
      },
    );

    if (input.name && input.name !== existing.name) {
      await this.assertUniqueName(existing.spaceId, input.name, existing.id);
    }
    if (input.ownerId) {
      await this.requireActiveSpaceOwner(
        access.space.organizationId,
        existing.spaceId,
        input.ownerId,
      );
    }

    const updated = await this.versions.update({
      versionId,
      name: input.name,
      target: input.target,
      description: input.description,
      ownerId: input.ownerId,
      status: input.status,
      startDate: parseOptionalDate(input.startDate, "startDate"),
      targetDate: parseOptionalDate(input.targetDate, "targetDate"),
      releaseDate: parseOptionalDate(input.releaseDate, "releaseDate"),
      updatedById: actorUserId,
    });

    if (!updated) {
      throwVersionNotFound();
    }

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: updated,
      before: existing,
      ...metadata,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: versionId,
      targetType: "VERSION",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      target: { type: "VERSION", id: updated.id },
      operation: "UPDATED",
      invalidates: ["version-board", "space-overview"],
      hints: {
        targetType: "VERSION",
        targetId: updated.id,
        spaceId: updated.spaceId,
        versionId: updated.id,
        changedFields: changedFieldsFromVersionUpdate(input),
      },
    });

    return updated;
  }

  private safePublishRealtime(
    input: Parameters<RealtimePublisherService["publish"]>[0],
  ) {
    try {
      this.realtime.publish(input);
    } catch (error) {
      this.logger.error(
        "Failed to publish version realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async requireSpaceAccess(userId: string, spaceId: string) {
    const access = await this.spaces.findAccessibleById(userId, spaceId);

    if (!access) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireSpaceManager(
    userId: string,
    spaceId: string,
    auditContext?: {
      metadata: RequestMetadata;
      operation: string;
      targetId: string;
      targetType: string;
    },
  ) {
    const access = await this.requireSpaceAccess(userId, spaceId);

    if (!SPACE_MANAGER_ROLES.has(access.role)) {
      if (auditContext) {
        await auditAccessDenied(this.audit, {
          ...auditContext.metadata,
          actorId: userId,
          metadata: { role: access.role },
          operation: auditContext.operation,
          organizationId: access.space.organizationId,
          reason: "ROLE_NOT_ALLOWED",
          spaceId,
          targetId: auditContext.targetId,
          targetType: auditContext.targetType,
        });
      }
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireActiveSpaceOwner(
    organizationId: string,
    spaceId: string,
    ownerId: string,
  ) {
    const organizationMember = await this.organizations.findMemberByUserId(
      organizationId,
      ownerId,
    );

    if (!organizationMember || organizationMember.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_MUST_BELONG_TO_ORGANIZATION",
        "Version owner must belong to the same organization",
        HttpStatus.BAD_REQUEST,
      );
    }

    const spaceMember = await this.spaces.findMemberByUserId(spaceId, ownerId);

    if (!spaceMember || spaceMember.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_NOT_FOUND",
        "Version owner must be an active space member",
        HttpStatus.NOT_FOUND,
      );
    }

    return spaceMember;
  }

  private async assertUniqueName(
    spaceId: string,
    name: string,
    exceptVersionId?: string,
  ) {
    const existing = await this.versions.findByName(spaceId, name);

    if (existing && existing.id !== exceptVersionId) {
      throw new ApiException(
        "CONFLICT",
        "Version name already exists in space",
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertBoardScope(version: Version, input: VersionBoardViewQuery) {
    if (input.organizationId && input.organizationId !== version.organizationId) {
      throw new ApiException(
        "CROSS_ORGANIZATION_ACCESS_DENIED",
        "Version belongs to a different organization",
        HttpStatus.FORBIDDEN,
      );
    }

    if (input.spaceId && input.spaceId !== version.spaceId) {
      throwSpaceAccessDenied();
    }
  }

  private async withVisibleStats(
    version: Version,
    actorUserId: string,
    role: SpaceRole,
  ) {
    const visibility = resolveVersionStatsVisibility(role);

    if (visibility === "SPACE") {
      return version;
    }

    return (
      (await this.versions.findById(
        version.id,
        withRequirementStatsVisibility(
          {
            actorUserId,
            spaceId: version.spaceId,
            visibility,
          },
          role,
        ),
      )) ?? version
    );
  }
}

function resolveVersionBoardVisibility(role: SpaceRole): VersionBoardVisibility {
  if (canReadAllSpaceWorkItems(role)) {
    return "SPACE";
  }

  if (role === "TESTER") {
    return "TESTER";
  }

  return "PARTICIPANT";
}

function resolveVersionStatsVisibility(role: SpaceRole): VersionStatsVisibility {
  if (canReadAllSpaceWorkItems(role)) {
    return "SPACE";
  }

  if (role === "TESTER") {
    return "TESTER";
  }

  return "PARTICIPANT";
}

function withRequirementStatsVisibility<T>(
  input: T,
  role: SpaceRole,
): WithRequirementStatsVisibility<T> {
  if (!REQUIREMENT_STATS_READ_ALL_ROLES.has(role)) {
    return input as WithRequirementStatsVisibility<T>;
  }

  return {
    ...input,
    requirementStatsVisibility: "SPACE",
  };
}

function changedFieldsFromVersionUpdate(input: UpdateVersionRequest) {
  return Object.keys(input);
}

function parseOptionalDate(value: string | undefined, field: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiException(
      "VALIDATION_ERROR",
      `${field} must be a valid date-time string`,
      HttpStatus.BAD_REQUEST,
    );
  }

  return date;
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwVersionNotFound(): never {
  throw new ApiException("NOT_FOUND", "Version not found", HttpStatus.NOT_FOUND);
}
