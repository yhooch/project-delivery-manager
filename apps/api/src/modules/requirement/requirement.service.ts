import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  type CreateRequirementDraftRequest,
  type PageResult,
  type PermissionSnapshot,
  type Requirement,
  type SaveRequirementRequest,
  type SpaceRole,
  type UpdateRequirementRequest,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import {
  VERSION_REPOSITORY,
  type VersionRepository,
} from "../version/version.repository";
import {
  REQUIREMENT_REPOSITORY,
  type RequirementRepository,
} from "./requirement.repository";
import type {
  RequirementListInput,
  RequirementListVisibility,
} from "./requirement.types";

const REQUIREMENT_WRITER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);
const REQUIREMENT_NON_DRAFT_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
  "VIEWER",
]);

@Injectable()
export class RequirementService {
  constructor(
    @Inject(REQUIREMENT_REPOSITORY)
    private readonly requirements: RequirementRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(VERSION_REPOSITORY)
    private readonly versions: VersionRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: Omit<RequirementListInput, "actorUserId" | "visibility">,
  ): Promise<PageResult<Requirement>> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    if (input.ownerId) {
      await this.requireActiveSpaceOwner(
        access.space.organizationId,
        spaceId,
        input.ownerId,
      );
    }
    if (input.versionId) {
      await this.requireVersionInSpace(spaceId, input.versionId);
    }

    const page = await this.requirements.listBySpaceId(spaceId, {
      ...input,
      actorUserId,
      visibility: resolveRequirementListVisibility(access.role),
    });

    return {
      ...page,
      items: page.items.map((requirement) =>
        withPermissions(requirement, access.role),
      ),
    };
  }

  async createDraft(
    actorUserId: string,
    spaceId: string,
    input: CreateRequirementDraftRequest,
  ): Promise<Requirement> {
    const access = await this.requireRequirementWriter(actorUserId, spaceId);

    if (input.versionId) {
      await this.requireVersionInSpace(spaceId, input.versionId);
    }

    return withPermissions(
      await this.requirements.createDraft({
        id: ulid(),
        organizationId: access.space.organizationId,
        spaceId,
        versionId: input.versionId,
        createdById: actorUserId,
      }),
      access.role,
    );
  }

  async get(actorUserId: string, requirementId: string): Promise<Requirement> {
    const requirement = await this.requireExistingRequirement(requirementId);
    const access = await this.requireSpaceAccess(actorUserId, requirement.spaceId);

    if (!(await this.canReadRequirement(actorUserId, requirement, access.role))) {
      throwRequirementNotFound();
    }

    return withPermissions(requirement, access.role);
  }

  async update(
    actorUserId: string,
    requirementId: string,
    input: UpdateRequirementRequest,
  ): Promise<Requirement> {
    const existing = await this.requireExistingRequirement(requirementId);
    const access = await this.requireRequirementWriter(
      actorUserId,
      existing.spaceId,
    );
    await this.requireDraftParticipant(actorUserId, existing);

    if (isArchiveRequest(input)) {
      const archived = await this.requirements.archive({
        requirementId,
        updatedById: actorUserId,
      });

      return archived
        ? withPermissions(archived, access.role)
        : throwRequirementNotFound();
    }

    this.assertCanSave(existing);
    this.assertValidContent(input);

    if (input.versionId) {
      await this.requireVersionInSpace(existing.spaceId, input.versionId);
    }
    if (input.ownerId) {
      await this.requireActiveSpaceOwner(
        access.space.organizationId,
        existing.spaceId,
        input.ownerId,
      );
    }

    const saved = await this.requirements.save({
      requirementId,
      title: input.title,
      summary: input.summary,
      contentJson: input.contentJson,
      contentText: input.contentText,
      contentMarkdownCache: input.contentMarkdownCache,
      versionId: input.versionId,
      priority: input.priority,
      ownerId: input.ownerId,
      shouldUpdateOwner: Object.prototype.hasOwnProperty.call(input, "ownerId"),
      updatedById: actorUserId,
    });

    return saved ? withPermissions(saved, access.role) : throwRequirementNotFound();
  }

  private async requireExistingRequirement(requirementId: string) {
    const requirement = await this.requirements.findById(requirementId);

    if (!requirement) {
      throwRequirementNotFound();
    }

    return requirement;
  }

  private async requireSpaceAccess(userId: string, spaceId: string) {
    const access = await this.spaces.findAccessibleById(userId, spaceId);

    if (!access) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireRequirementWriter(userId: string, spaceId: string) {
    const access = await this.requireSpaceAccess(userId, spaceId);

    if (!REQUIREMENT_WRITER_ROLES.has(access.role)) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async canReadRequirement(
    actorUserId: string,
    requirement: Requirement,
    role: SpaceRole,
  ) {
    if (
      requirement.status !== "DRAFT" &&
      (REQUIREMENT_WRITER_ROLES.has(role) ||
        REQUIREMENT_NON_DRAFT_READ_ALL_ROLES.has(role))
    ) {
      return true;
    }

    return this.requirements.isParticipant(
      requirement.spaceId,
      requirement.id,
      actorUserId,
    );
  }

  private async requireVersionInSpace(spaceId: string, versionId: string) {
    const version = await this.versions.findById(versionId);

    if (!version || version.spaceId !== spaceId) {
      throw new ApiException("NOT_FOUND", "Version not found", HttpStatus.NOT_FOUND);
    }

    return version;
  }

  private async requireDraftParticipant(
    actorUserId: string,
    requirement: Requirement,
  ) {
    if (requirement.status !== "DRAFT") {
      return;
    }

    if (
      await this.requirements.isParticipant(
        requirement.spaceId,
        requirement.id,
        actorUserId,
      )
    ) {
      return;
    }

    throwRequirementNotFound();
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
        "Requirement owner must belong to the same organization",
        HttpStatus.BAD_REQUEST,
      );
    }

    const spaceMember = await this.spaces.findMemberByUserId(spaceId, ownerId);

    if (!spaceMember || spaceMember.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_NOT_FOUND",
        "Requirement owner must be an active space member",
        HttpStatus.NOT_FOUND,
      );
    }

    return spaceMember;
  }

  private assertCanSave(requirement: Requirement) {
    if (requirement.status === "ARCHIVED") {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Archived requirement cannot be saved",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertValidContent(input: SaveRequirementRequest) {
    if (Object.keys(input.contentJson).length === 0) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "contentJson must contain a Tiptap document",
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

function isArchiveRequest(
  input: UpdateRequirementRequest,
): input is Extract<UpdateRequirementRequest, { status: "ARCHIVED" }> {
  return "status" in input && input.status === "ARCHIVED";
}

function resolveRequirementListVisibility(
  role: SpaceRole,
): RequirementListVisibility {
  if (REQUIREMENT_WRITER_ROLES.has(role)) {
    return "ALL";
  }

  if (REQUIREMENT_NON_DRAFT_READ_ALL_ROLES.has(role)) {
    return "NON_DRAFT_OR_PARTICIPANT_DRAFT";
  }

  return "PARTICIPANT";
}

function withPermissions(
  requirement: Requirement,
  role: SpaceRole,
): Requirement {
  return {
    ...requirement,
    permissions: toPermissionSnapshot(requirement, role),
  };
}

function toPermissionSnapshot(
  requirement: Requirement,
  role: SpaceRole,
): PermissionSnapshot {
  const canEdit =
    requirement.status !== "ARCHIVED" && REQUIREMENT_WRITER_ROLES.has(role);
  const canComment = requirement.status !== "ARCHIVED" && role !== "VIEWER";

  return {
    availableActions: [],
    canComment,
    canEdit,
    canUploadAttachment: canEdit && requirement.status === "DRAFT",
  };
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwRequirementNotFound(): never {
  throw new ApiException(
    "REQUIREMENT_NOT_FOUND",
    "Requirement not found",
    HttpStatus.NOT_FOUND,
  );
}
