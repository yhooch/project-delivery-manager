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
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
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
    @Inject(AuditService)
    private readonly audit: AuditService,
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
    metadata: RequestMetadata = {},
  ): Promise<Requirement> {
    const access = await this.requireRequirementWriter(actorUserId, spaceId);

    if (input.versionId) {
      await this.requireVersionInSpace(spaceId, input.versionId);
    }

    const created = await this.requirements.createDraft({
      id: ulid(),
      organizationId: access.space.organizationId,
      spaceId,
      versionId: input.versionId,
      createdById: actorUserId,
    });

    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created,
      ...metadata,
      organizationId: access.space.organizationId,
      spaceId,
      targetId: created.id,
      targetType: "REQUIREMENT",
    });

    return withPermissions(created, access.role);
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
    metadata: RequestMetadata = {},
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

      if (!archived) {
        throwRequirementNotFound();
      }

      await this.audit.record({
        actionType: "UPDATE",
        actorId: actorUserId,
        after: archived,
        before: existing,
        metadata: { operation: "ARCHIVE" },
        ...metadata,
        organizationId: existing.organizationId,
        spaceId: existing.spaceId,
        targetId: requirementId,
        targetType: "REQUIREMENT",
      });

      return withPermissions(archived, access.role);
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

    if (!saved) {
      throwRequirementNotFound();
    }

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: saved,
      before: existing,
      metadata: { operation: "SAVE" },
      ...metadata,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: requirementId,
      targetType: "REQUIREMENT",
    });

    return withPermissions(saved, access.role);
  }

  async deleteDraft(
    actorUserId: string,
    requirementId: string,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    const existing = await this.requireExistingRequirement(requirementId);

    await this.requireSpaceAccess(actorUserId, existing.spaceId);
    this.assertCanDeleteDraft(actorUserId, existing);

    const deleted = await this.requirements.deleteDraft({
      deletedById: actorUserId,
      requirementId,
    });

    if (!deleted) {
      throwRequirementNotFound();
    }

    await this.audit.record({
      actionType: "DELETE",
      actorId: actorUserId,
      before: existing,
      metadata: { operation: "DELETE_EMPTY_DRAFT" },
      ...metadata,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: requirementId,
      targetType: "REQUIREMENT",
    });
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

    if (!isValidTiptapContentJson(input.contentJson)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "contentJson must be a valid Tiptap document without base64 images",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertCanDeleteDraft(actorUserId: string, requirement: Requirement) {
    if (requirement.status !== "DRAFT") {
      throw new ApiException(
        "DRAFT_REQUIREMENT_REQUIRED",
        "Only draft requirements can be deleted",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (requirement.authorId !== actorUserId) {
      throwRequirementNotFound();
    }

    if (!isEmptyDraftRequirement(requirement)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Only empty draft requirements can be deleted",
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

function isEmptyDraftRequirement(requirement: Requirement): boolean {
  return (
    requirement.title.trim().length === 0 &&
    !hasText(requirement.summary) &&
    !hasText(requirement.contentText) &&
    !hasText(requirement.contentMarkdownCache) &&
    !hasMeaningfulTiptapContent(requirement.contentJson) &&
    (requirement.attachments?.length ?? 0) === 0
  );
}

function hasMeaningfulTiptapContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulTiptapContent(item));
  }

  if (!isPlainRecord(value)) {
    return false;
  }

  if (typeof value.text === "string" && value.text.trim().length > 0) {
    return true;
  }

  if (
    typeof value.type === "string" &&
    !["doc", "paragraph", "text"].includes(value.type)
  ) {
    return true;
  }

  return hasMeaningfulTiptapContent(value.content);
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTiptapContentJson(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    !containsBase64ImageData(value) &&
    isValidTiptapNode(value, true)
  );
}

function isValidTiptapNode(value: unknown, isRoot = false): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }

  if (
    !Object.keys(value).every((key) =>
      ["attrs", "content", "marks", "text", "type"].includes(key),
    )
  ) {
    return false;
  }

  if (typeof value.type !== "string" || value.type.trim().length === 0) {
    return false;
  }

  if (isRoot && value.type !== "doc") {
    return false;
  }

  if ("text" in value && typeof value.text !== "string") {
    return false;
  }

  if (value.type === "text" && typeof value.text !== "string") {
    return false;
  }

  if ("attrs" in value && !isJsonCompatibleObject(value.attrs)) {
    return false;
  }

  if (
    "content" in value &&
    (!Array.isArray(value.content) ||
      !value.content.every((item) => isValidTiptapNode(item)))
  ) {
    return false;
  }

  if (
    "marks" in value &&
    (!Array.isArray(value.marks) ||
      !value.marks.every((item) => isValidTiptapMark(item)))
  ) {
    return false;
  }

  return true;
}

function isValidTiptapMark(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }

  if (!Object.keys(value).every((key) => ["attrs", "type"].includes(key))) {
    return false;
  }

  return (
    typeof value.type === "string" &&
    value.type.trim().length > 0 &&
    (!("attrs" in value) || isJsonCompatibleObject(value.attrs))
  );
}

function containsBase64ImageData(value: unknown): boolean {
  if (typeof value === "string") {
    return /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64(?:,|$)/iu.test(
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsBase64ImageData(item));
  }

  if (!isPlainRecord(value)) {
    return false;
  }

  return Object.values(value).some((item) => containsBase64ImageData(item));
}

function isJsonCompatibleObject(value: unknown): boolean {
  return isPlainRecord(value) && isJsonCompatible(value);
}

function isJsonCompatible(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonCompatible(item));
  }

  if (isPlainRecord(value)) {
    return Object.values(value).every((item) => isJsonCompatible(item));
  }

  return false;
}
