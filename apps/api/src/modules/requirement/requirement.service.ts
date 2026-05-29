import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  type CreateRequirementDraftRequest,
  type ListRequirementsResponse,
  type PermissionSnapshot,
  type RealtimePayloadHints,
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
const REQUIREMENT_DOCUMENT_TARGET_TYPE = "DOCUMENT" as const;
const REQUIREMENT_DOCUMENT_KIND = "REQUIREMENT" as const;
type ValidateRequirementCreationInput = CreateRequirementDraftRequest &
  Omit<SaveRequirementRequest, "baseRevision">;
type RequirementSaveContentSource = Omit<
  SaveRequirementRequest,
  "baseRevision"
>;

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
      contentFormat: input.contentFormat ?? "TIPTAP_JSON",
      tagIds: input.tagIds,
      versionId: input.versionId,
      createdById: actorUserId,
    });

    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created,
      metadata: requirementAuditMetadata("CREATE_DRAFT"),
      ...metadata,
      organizationId: access.space.organizationId,
      spaceId,
      targetId: created.id,
      targetType: REQUIREMENT_DOCUMENT_TARGET_TYPE,
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      target: requirementRealtimeTarget(created.id),
      operation: "CREATED",
      invalidates: ["requirement-list", "requirement-detail", "version-board"],
      hints: requirementRealtimeHints(created, {
        ...(created.versionId ? { versionId: created.versionId } : {}),
      }),
    });

    return withPermissions(created, access.role);
  }

  async validateCreateRequest(
    actorUserId: string,
    spaceId: string,
    input: ValidateRequirementCreationInput,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    const access = await this.requireRequirementWriter(actorUserId, spaceId, {
      metadata,
      operation: "createRequirement",
      targetId: spaceId,
      targetType: "SPACE",
    });

    this.assertValidContent(input);

    if (input.versionId) {
      await this.requireVersionInSpace(spaceId, input.versionId);
    }
    if (input.ownerId) {
      await this.requireActiveSpaceOwner(
        access.space.organizationId,
        spaceId,
        input.ownerId,
      );
    }
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
    this.assertBaseRevision(input.baseRevision, existing.revision);
    const access = await this.requireRequirementWriter(
      actorUserId,
      existing.spaceId,
      {
        metadata,
        operation: "updateRequirement",
        targetId: requirementId,
        targetType: REQUIREMENT_DOCUMENT_TARGET_TYPE,
      },
    );

    if (isArchiveRequest(input)) {
      const archived = await this.requirements.archive({
        baseRevision: input.baseRevision,
        requirementId,
        updatedById: actorUserId,
      });

      if (!archived) {
        await this.throwIfRequirementRevisionConflict(
          requirementId,
          input.baseRevision,
        );
        throwRequirementNotFound();
      }

      await this.audit.record({
        actionType: "UPDATE",
        actorId: actorUserId,
        after: archived,
        before: existing,
        metadata: requirementAuditMetadata("ARCHIVE"),
        ...metadata,
        organizationId: existing.organizationId,
        spaceId: existing.spaceId,
        targetId: requirementId,
        targetType: REQUIREMENT_DOCUMENT_TARGET_TYPE,
      });

      this.safePublishRealtime({
        actorId: actorUserId,
        organizationId: archived.organizationId,
        spaceId: archived.spaceId,
        target: requirementRealtimeTarget(archived.id),
        operation: "STATUS_CHANGED",
        invalidates: [
          "requirement-list",
          "requirement-detail",
          "version-board",
        ],
        hints: requirementRealtimeHints(archived, {
          ...(archived.versionId ? { versionId: archived.versionId } : {}),
          changedFields: ["status"],
        }),
      });

      return withPermissions(archived, access.role);
    }

    this.assertCanSave(existing);
    this.assertValidContent(input, existing);
    const saveContent = toSaveRequirementContent(input);

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
        targetType: REQUIREMENT_DOCUMENT_TARGET_TYPE,
        toVersionId: versionId ?? null,
      });
    }

    const saveBase = {
      baseRevision: input.baseRevision,
      requirementId,
      title: input.title,
      summary: input.summary,
      versionId,
      cascadeVersionChange: input.cascadeVersionChange,
      priority: input.priority,
      ownerId: input.ownerId,
      shouldUpdateOwner: Object.prototype.hasOwnProperty.call(input, "ownerId"),
      updatedById: actorUserId,
    };
    const saved = await this.requirements.save({
      ...saveBase,
      ...saveContent,
    });

    if (!saved) {
      await this.throwIfRequirementRevisionConflict(
        requirementId,
        input.baseRevision,
      );
      throwRequirementNotFound();
    }

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: saved,
      before: existing,
      metadata: {
        targetKind: REQUIREMENT_DOCUMENT_KIND,
        operation: "SAVE",
        ...(input.cascadeVersionChange === true && versionCascadeImpact
          ? { versionCascade: toCascadeAuditMetadata(versionCascadeImpact) }
          : {}),
      },
      ...metadata,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: requirementId,
      targetType: REQUIREMENT_DOCUMENT_TARGET_TYPE,
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: saved.organizationId,
      spaceId: saved.spaceId,
      target: requirementRealtimeTarget(saved.id),
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
      hints: requirementRealtimeHints(saved, {
        ...(saved.versionId ? { versionId: saved.versionId } : {}),
        changedFields: changedFieldsFromRequirementUpdate(input),
        ...(input.cascadeVersionChange === true
          ? { suggestFullRefresh: true }
          : {}),
      }),
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
      metadata: requirementAuditMetadata("DELETE_DRAFT"),
      ...metadata,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: requirementId,
      targetType: REQUIREMENT_DOCUMENT_TARGET_TYPE,
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      target: requirementRealtimeTarget(requirementId),
      operation: "DELETED",
      invalidates: ["requirement-list", "requirement-detail", "version-board"],
      hints: requirementRealtimeHints(existing, {
        ...(existing.versionId ? { versionId: existing.versionId } : {}),
      }),
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
          metadata: {
            role: access.role,
            ...(auditContext.targetType === REQUIREMENT_DOCUMENT_TARGET_TYPE
              ? { targetKind: REQUIREMENT_DOCUMENT_KIND }
              : {}),
          },
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
    _actorUserId: string,
    _requirement: Requirement,
    _role: SpaceRole,
  ) {
    return true;
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

  private assertBaseRevision(baseRevision: number, currentRevision?: number) {
    if (currentRevision === undefined || currentRevision === baseRevision) {
      return;
    }

    throw new ApiException(
      "DOCUMENT_EDIT_CONFLICT",
      "Requirement revision conflict",
      HttpStatus.CONFLICT,
    );
  }

  private async throwIfRequirementRevisionConflict(
    requirementId: string,
    baseRevision: number,
  ) {
    const current = await this.requirements.findById(requirementId);

    if (current?.revision !== undefined && current.revision !== baseRevision) {
      throw new ApiException(
        "DOCUMENT_EDIT_CONFLICT",
        "Requirement revision conflict",
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertValidContent(
    input: RequirementSaveContentSource,
    requirement?: Requirement,
  ) {
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

    if (resolveSaveContentFormat(input) === "MARKDOWN") {
      if (!hasText(input.contentMarkdown)) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "contentMarkdown must contain Markdown content",
          HttpStatus.BAD_REQUEST,
        );
      }

      if (
        containsBase64ImageData(input.contentMarkdown) ||
        containsDisallowedMarkdownImage(input.contentMarkdown)
      ) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Markdown content must not contain unsafe images",
          HttpStatus.BAD_REQUEST,
        );
      }

      this.assertValidMarkdownAttachmentImages(
        input.contentMarkdown,
        requirement,
      );

      return;
    }

    if (!input.contentJson || Object.keys(input.contentJson).length === 0) {
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
        metadata: {
          targetKind: REQUIREMENT_DOCUMENT_KIND,
        },
        operation: "deleteRequirementDraft",
        organizationId: requirement.organizationId,
        reason: "DRAFT_REQUIREMENT_AUTHOR_REQUIRED",
        spaceId: requirement.spaceId,
        targetId: requirement.id,
        targetType: REQUIREMENT_DOCUMENT_TARGET_TYPE,
      });
      throwRequirementNotFound();
    }
  }

  private assertValidMarkdownAttachmentImages(
    markdown: string,
    requirement?: Requirement,
  ) {
    const attachmentIds = extractMarkdownAttachmentImageIds(markdown);

    if (attachmentIds.length === 0) {
      return;
    }

    if (!requirement) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Markdown image attachments can only be referenced after uploading them to an existing requirement",
        HttpStatus.BAD_REQUEST,
      );
    }

    const attachmentsById = new Map(
      (requirement.attachments ?? []).map((attachment) => [
        attachment.id,
        attachment,
      ]),
    );

    for (const attachmentId of new Set(attachmentIds)) {
      const attachment = attachmentsById.get(attachmentId);

      if (!attachment) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Markdown image attachment must belong to the current requirement",
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!attachment.mimeType.toLowerCase().startsWith("image/")) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Markdown image attachment must reference an image attachment",
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }
}

function isArchiveRequest(
  input: UpdateRequirementRequest,
): input is Extract<UpdateRequirementRequest, { status: "ARCHIVED" }> {
  return "status" in input && input.status === "ARCHIVED";
}

function resolveRequirementListVisibility(
  _role: SpaceRole,
): RequirementListVisibility {
  return "ALL";
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

type SaveRequirementContentInput =
  | {
      contentFormat: "TIPTAP_JSON";
      contentJson: NonNullable<SaveRequirementRequest["contentJson"]>;
      contentMarkdownCache?: string;
      contentText: string;
    }
  | {
      contentFormat: "MARKDOWN";
      contentMarkdown: string;
      contentText: string;
    };

function toSaveRequirementContent(
  input: RequirementSaveContentSource,
): SaveRequirementContentInput {
  if (resolveSaveContentFormat(input) === "MARKDOWN") {
    const contentMarkdown = input.contentMarkdown ?? "";

    return {
      contentFormat: "MARKDOWN",
      contentMarkdown,
      contentText:
        input.contentText ?? extractTextFromMarkdown(contentMarkdown) ?? "",
    };
  }

  const contentJson = input.contentJson ?? {};

  return {
    contentFormat: "TIPTAP_JSON",
    contentJson,
    contentMarkdownCache: input.contentMarkdownCache,
    contentText:
      input.contentText ??
      (input.contentMarkdownCache
        ? extractTextFromMarkdown(input.contentMarkdownCache)
        : undefined) ??
      extractTextFromTiptapContent(contentJson) ??
      "",
  };
}

function resolveSaveContentFormat(
  input: RequirementSaveContentSource,
): "TIPTAP_JSON" | "MARKDOWN" {
  return (
    input.contentFormat ??
    (input.contentMarkdown !== undefined && input.contentJson === undefined
      ? "MARKDOWN"
      : "TIPTAP_JSON")
  );
}

function containsDisallowedMarkdownImage(markdown: string): boolean {
  return extractMarkdownImageTargets(markdown).some(
    (target) => !isAllowedMarkdownImageTarget(target),
  );
}

function extractMarkdownAttachmentImageIds(markdown: string): string[] {
  return extractMarkdownImageTargets(markdown)
    .filter((target) => target.startsWith("attachment://"))
    .map((target) => target.slice("attachment://".length));
}

function extractMarkdownImageTargets(markdown: string): string[] {
  return Array.from(
    markdown.matchAll(/!\[[^\]\n]*\]\(([^)\n]*)\)/gu),
    (match) => normalizeMarkdownLinkTarget(match[1] ?? ""),
  ).filter((target) => target.length > 0);
}

function normalizeMarkdownLinkTarget(raw: string): string {
  const target = raw.trim().split(/\s+/u)[0] ?? "";

  return target.replace(/^<|>$/gu, "");
}

function isAllowedMarkdownImageTarget(target: string): boolean {
  return /^attachment:\/\/[A-Za-z0-9._~%-]+$/u.test(target);
}

function extractTextFromMarkdown(markdown: string): string | undefined {
  const text = markdown
    .replace(/!\[([^\]\n]*)\]\([^\n)]*\)/gu, "$1")
    .replace(/\[([^\]\n]+)\]\([^\n)]*\)/gu, "$1")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/u, "")
        .replace(/^\s{0,3}>\s?/u, "")
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/u, "")
        .replace(/^\s*([-*+]|\d+[.)])\s+/u, "")
        .replace(/[`*_~]/gu, "")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join("\n\n");

  return text.length > 0 ? text : undefined;
}

function extractTextFromTiptapContent(value: unknown): string | undefined {
  const lines: string[] = [];

  collectTiptapText(value, lines);

  const text = lines
    .join("\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function collectTiptapText(value: unknown, lines: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTiptapText(item, lines);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  if (typeof value.text === "string") {
    lines.push(value.text);
  }

  collectTiptapText(value.content, lines);
}

function requirementAuditMetadata(operation: string) {
  return {
    operation,
    targetKind: REQUIREMENT_DOCUMENT_KIND,
  };
}

function requirementRealtimeTarget(id: string) {
  return {
    type: REQUIREMENT_DOCUMENT_TARGET_TYPE,
    id,
  };
}

function requirementRealtimeHints(
  requirement: Pick<Requirement, "id" | "spaceId">,
  extra: Partial<RealtimePayloadHints> = {},
): RealtimePayloadHints {
  return {
    targetType: REQUIREMENT_DOCUMENT_TARGET_TYPE,
    targetKind: REQUIREMENT_DOCUMENT_KIND,
    targetId: requirement.id,
    requirementId: requirement.id,
    spaceId: requirement.spaceId,
    ...extra,
  };
}

function hasText(value: string | undefined): value is string {
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
