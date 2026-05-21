import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  type CreateRequirementDraftRequest,
  type ListRequirementsResponse,
  type PermissionSnapshot,
  type Requirement,
  type SaveRequirementRequest,
  type SpaceRole,
  type UpdateRequirementRequest,
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
} from "../version/version.repository";
import {
  hasTraceVersionCascadeImpact,
  hasTraceVersionChange,
  throwTraceVersionChangeRequiresCascade,
} from "../trace/trace-version-policy";
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
  private readonly logger = new Logger(RequirementService.name);

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
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: Omit<RequirementListInput, "actorUserId" | "visibility">,
  ): Promise<ListRequirementsResponse> {
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
    const access = await this.requireRequirementWriter(actorUserId, spaceId, {
      metadata,
      operation: "createRequirementDraft",
      targetId: spaceId,
      targetType: "SPACE",
    });

    if (input.versionId) {
      await this.requireVersionInSpace(spaceId, input.versionId);
    }

    const created = await this.requirements.createDraft({
      id: ulid(),
      organizationId: access.space.organizationId,
      spaceId,
      tagIds: input.tagIds,
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

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      target: { type: "REQUIREMENT", id: created.id },
      operation: "CREATED",
      invalidates: ["requirement-list", "requirement-detail", "version-board"],
      hints: {
        targetType: "REQUIREMENT",
        targetId: created.id,
        spaceId: created.spaceId,
        ...(created.versionId ? { versionId: created.versionId } : {}),
      },
    });

    return withPermissions(created, access.role);
  }

  async get(actorUserId: string, requirementId: string): Promise<Requirement> {
    const requirement = await this.requireExistingRequirement(requirementId);
    const access = await this.requireSpaceAccess(
      actorUserId,
      requirement.spaceId,
    );

    if (
      !(await this.canReadRequirement(actorUserId, requirement, access.role))
    ) {
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
      {
        metadata,
        operation: "updateRequirement",
        targetId: requirementId,
        targetType: "REQUIREMENT",
      },
    );
    await this.requireDraftParticipant(actorUserId, existing, {
      metadata,
      operation: "updateRequirement",
    });

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

      this.safePublishRealtime({
        actorId: actorUserId,
        organizationId: archived.organizationId,
        spaceId: archived.spaceId,
        target: { type: "REQUIREMENT", id: archived.id },
        operation: "STATUS_CHANGED",
        invalidates: [
          "requirement-list",
          "requirement-detail",
          "version-board",
        ],
        hints: {
          targetType: "REQUIREMENT",
          targetId: archived.id,
          spaceId: archived.spaceId,
          ...(archived.versionId ? { versionId: archived.versionId } : {}),
          changedFields: ["status"],
        },
      });

      return withPermissions(archived, access.role);
    }

    this.assertCanSave(existing);
    this.assertValidContent(input);

    const versionId = Object.prototype.hasOwnProperty.call(input, "versionId")
      ? input.versionId
      : undefined;

    if (versionId) {
      await this.requireVersionInSpace(existing.spaceId, versionId);
    }
    if (input.ownerId) {
      await this.requireActiveSpaceOwner(
        access.space.organizationId,
        existing.spaceId,
        input.ownerId,
      );
    }

    const versionCascadeImpact = hasTraceVersionChange(
      existing.versionId,
      versionId,
    )
      ? await this.requirements.countVersionCascadeImpact({
          nextVersionId: versionId ?? null,
          requirementId,
        })
      : undefined;

    if (
      versionCascadeImpact &&
      hasTraceVersionCascadeImpact(versionCascadeImpact) &&
      input.cascadeVersionChange !== true
    ) {
      throwTraceVersionChangeRequiresCascade({
        fromVersionId: existing.versionId,
        impact: versionCascadeImpact,
        targetId: requirementId,
        targetType: "REQUIREMENT",
        toVersionId: versionId ?? null,
      });
    }

    const saved = await this.requirements.save({
      requirementId,
      title: input.title,
      summary: input.summary,
      contentJson: input.contentJson,
      contentText: input.contentText,
      contentMarkdownCache: input.contentMarkdownCache,
      versionId,
      cascadeVersionChange: input.cascadeVersionChange,
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
      metadata: {
        operation: "SAVE",
        ...(input.cascadeVersionChange === true && versionCascadeImpact
          ? { versionCascade: toCascadeAuditMetadata(versionCascadeImpact) }
          : {}),
      },
      ...metadata,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: requirementId,
      targetType: "REQUIREMENT",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: saved.organizationId,
      spaceId: saved.spaceId,
      target: { type: "REQUIREMENT", id: saved.id },
      operation: "UPDATED",
      invalidates: [
        "requirement-list",
        "requirement-detail",
        "version-board",
        ...(input.cascadeVersionChange === true
          ? [
              "intake-list" as const,
              "work-item-list" as const,
              "bug-list" as const,
              "workbench" as const,
              "space-overview" as const,
              "exception-view" as const,
              "timeline" as const,
            ]
          : []),
      ],
      hints: {
        targetType: "REQUIREMENT",
        targetId: saved.id,
        spaceId: saved.spaceId,
        ...(saved.versionId ? { versionId: saved.versionId } : {}),
        changedFields: changedFieldsFromRequirementUpdate(input),
        ...(input.cascadeVersionChange === true
          ? { suggestFullRefresh: true }
          : {}),
      },
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
    await this.assertCanDeleteDraft(actorUserId, existing, metadata);

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

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      target: { type: "REQUIREMENT", id: requirementId },
      operation: "DELETED",
      invalidates: ["requirement-list", "requirement-detail", "version-board"],
      hints: {
        targetType: "REQUIREMENT",
        targetId: requirementId,
        spaceId: existing.spaceId,
        ...(existing.versionId ? { versionId: existing.versionId } : {}),
      },
    });
  }

  private safePublishRealtime(
    input: Parameters<RealtimePublisherService["publish"]>[0],
  ) {
    try {
      this.realtime.publish(input);
    } catch (error) {
      this.logger.error(
        "Failed to publish requirement realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
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

  private async requireRequirementWriter(
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

    if (!REQUIREMENT_WRITER_ROLES.has(access.role)) {
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
      throw new ApiException(
        "NOT_FOUND",
        "Version not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return version;
  }

  private async requireDraftParticipant(
    actorUserId: string,
    requirement: Requirement,
    auditContext?: {
      metadata: RequestMetadata;
      operation: string;
    },
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

    if (auditContext) {
      await auditAccessDenied(this.audit, {
        ...auditContext.metadata,
        actorId: actorUserId,
        operation: auditContext.operation,
        organizationId: requirement.organizationId,
        reason: "DRAFT_REQUIREMENT_PARTICIPANT_REQUIRED",
        spaceId: requirement.spaceId,
        targetId: requirement.id,
        targetType: "REQUIREMENT",
      });
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

    if (
      containsBase64ImageData(input.contentText) ||
      containsBase64ImageData(input.contentMarkdownCache)
    ) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "requirement content must not contain base64 images",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async assertCanDeleteDraft(
    actorUserId: string,
    requirement: Requirement,
    metadata: RequestMetadata,
  ) {
    if (requirement.status !== "DRAFT") {
      throw new ApiException(
        "DRAFT_REQUIREMENT_REQUIRED",
        "Only draft requirements can be deleted",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (requirement.authorId !== actorUserId) {
      await auditAccessDenied(this.audit, {
        ...metadata,
        actorId: actorUserId,
        operation: "deleteRequirementDraft",
        organizationId: requirement.organizationId,
        reason: "DRAFT_REQUIREMENT_AUTHOR_REQUIRED",
        spaceId: requirement.spaceId,
        targetId: requirement.id,
        targetType: "REQUIREMENT",
      });
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

function toCascadeAuditMetadata(
  impact: NonNullable<
    Awaited<ReturnType<RequirementRepository["countVersionCascadeImpact"]>>
  >,
) {
  return {
    counts: {
      bugCount: impact.bugCount,
      intakeItemCount: impact.intakeItemCount ?? 0,
      relatedBugCount: impact.relatedBugCount ?? 0,
      workItemCount: impact.workItemCount,
    },
    affectedIds: {
      intakeItemIds: impact.intakeItemIds ?? [],
      relatedBugIds: impact.relatedBugIds ?? [],
      workItemIds: impact.workItemIds ?? [],
    },
  };
}

function changedFieldsFromRequirementUpdate(input: UpdateRequirementRequest) {
  return Object.keys(input).filter((field) => field !== "cascadeVersionChange");
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

function containsBase64ImageData(value: unknown): boolean {
  if (typeof value === "string") {
    return /data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64(?:,|$)/iu.test(
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
