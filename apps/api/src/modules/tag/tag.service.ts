import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  CreateTagRequest,
  ListTagFilterOptionsQuery,
  ListTagsQuery,
  MergeTagsRequest,
  MergeTagsResponse,
  PageResult,
  RealtimeInvalidationKey,
  SpaceRole,
  TagDto,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { auditAccessDenied } from "../audit/audit-access-denied";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import {
  colorKeyForNormalizedName,
  normalizeTagNameInput,
  normalizeTagSearchQuery,
} from "./tag-name";
import { TAG_REPOSITORY, type TagRepository } from "./tag.repository";

const TAG_CREATOR_DENIED_ROLES = new Set<SpaceRole>(["VIEWER"]);
const TAG_GOVERNANCE_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);

@Injectable()
export class TagService {
  private readonly logger = new Logger(TagService.name);

  constructor(
    @Inject(TAG_REPOSITORY)
    private readonly tags: TagRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: ListTagsQuery,
  ): Promise<PageResult<TagDto>> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    return this.tags.listBySpace({
      ...input,
      normalizedQuery: normalizeTagSearchQuery(input.query),
      organizationId: access.space.organizationId,
      spaceId,
    });
  }

  async listFilterOptions(
    actorUserId: string,
    spaceId: string,
    input: ListTagFilterOptionsQuery,
  ): Promise<{ items: TagDto[] }> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    return {
      items: await this.tags.listFilterOptions({
        ...input,
        now: new Date(),
        organizationId: access.space.organizationId,
        spaceId,
        staleThresholdDays: access.space.settings.staleThresholdDays,
      }),
    };
  }

  async create(
    actorUserId: string,
    spaceId: string,
    input: CreateTagRequest,
    metadata: RequestMetadata = {},
  ): Promise<TagDto> {
    const access = await this.requireTagCreator(actorUserId, spaceId, {
      metadata,
      operation: "createTag",
      targetId: spaceId,
      targetType: "SPACE",
    });
    const normalized = normalizeTagNameInput(input.name);
    const existing = await this.tags.findActiveByNormalizedName(
      spaceId,
      normalized.normalizedName,
    );

    if (existing) {
      return existing;
    }

    const created = await this.tags.create({
      id: ulid(),
      colorKey: colorKeyForNormalizedName(normalized.normalizedName),
      createdById: actorUserId,
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      organizationId: access.space.organizationId,
      spaceId,
    });

    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created,
      ...metadata,
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetId: created.id,
      targetType: "TAG",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      target: { type: "SPACE", id: created.spaceId },
      operation: "TAG_CHANGED",
      invalidates: tagInvalidates(),
      hints: {
        targetType: "SPACE",
        targetId: created.spaceId,
        spaceId: created.spaceId,
        tagId: created.id,
        changedFields: ["tags"],
      },
    });

    return created;
  }

  async delete(
    actorUserId: string,
    tagId: string,
    metadata: RequestMetadata = {},
  ): Promise<Record<string, never>> {
    const tag = await this.tags.findActiveById(tagId);

    if (!tag) {
      throwTagNotFound();
    }

    await this.requireTagDeleter(actorUserId, tag, {
      metadata,
      operation: "deleteTag",
      targetId: tagId,
      targetType: "TAG",
    });

    const result = await this.tags.softDeleteOrphan({
      tagId,
      updatedById: actorUserId,
    });

    if (result.status === "not_found") {
      throwTagNotFound();
    }

    if (result.status === "in_use") {
      throwTagInUse();
    }

    await this.audit.record({
      actionType: "DELETE",
      actorId: actorUserId,
      after: {
        ...result.tag,
        deletedAt: result.deletedAt.toISOString(),
      },
      before: tag,
      ...metadata,
      organizationId: tag.organizationId,
      spaceId: tag.spaceId,
      targetId: tag.id,
      targetType: "TAG",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: tag.organizationId,
      spaceId: tag.spaceId,
      target: { type: "SPACE", id: tag.spaceId },
      operation: "TAG_CHANGED",
      invalidates: tagInvalidates(),
      hints: {
        targetType: "SPACE",
        targetId: tag.spaceId,
        spaceId: tag.spaceId,
        tagId: tag.id,
        changedFields: ["tags"],
      },
    });

    return {};
  }

  async merge(
    actorUserId: string,
    spaceId: string,
    input: MergeTagsRequest,
    metadata: RequestMetadata = {},
  ): Promise<MergeTagsResponse> {
    const access = await this.requireTagGovernanceBySpace(actorUserId, spaceId, {
      metadata,
      operation: "mergeTags",
      targetId: spaceId,
      targetType: "SPACE",
    });
    const result = await this.tags.merge({
      dryRun: input.dryRun,
      organizationId: access.space.organizationId,
      spaceId,
      sourceTagIds: input.sourceTagIds,
      targetTagId: input.targetTagId,
      updatedById: actorUserId,
    });

    if (!result) {
      throwTagNotFound();
    }

    if (input.dryRun) {
      return result;
    }

    const auditMetadata = {
      operation: "MERGE_TAGS",
      sourceTagIds: input.sourceTagIds,
      targetTagId: input.targetTagId,
      sourceAssignmentsRemoved: result.sourceAssignmentsRemoved,
      targetAssignmentsCreated: result.targetAssignmentsCreated,
      duplicateAssignmentsSkipped: result.duplicateAssignmentsSkipped,
      deletedSourceTags: result.deletedSourceTags,
      affectedTargetsByType: result.affectedTargetsByType,
    };

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: result,
      before: {
        sourceTags: result.sourceTags,
        targetTag: result.targetTag,
      },
      metadata: auditMetadata,
      ...metadata,
      organizationId: access.space.organizationId,
      spaceId,
      targetId: spaceId,
      targetType: "SPACE",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: access.space.organizationId,
      spaceId,
      target: { type: "SPACE", id: spaceId },
      operation: "TAG_CHANGED",
      invalidates: tagMergeInvalidates(),
      hints: {
        targetType: "SPACE",
        targetId: spaceId,
        spaceId,
        sourceTagIds: input.sourceTagIds,
        targetTagId: input.targetTagId,
        changedFields: ["tags", "tagIds"],
        suggestFullRefresh: true,
      },
    });

    return result;
  }

  private safePublishRealtime(
    input: Parameters<RealtimePublisherService["publish"]>[0],
  ) {
    try {
      this.realtime.publish(input);
    } catch (error) {
      this.logger.error(
        "Failed to publish tag realtime event",
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

  private async requireTagCreator(
    userId: string,
    spaceId: string,
    auditContext: {
      metadata: RequestMetadata;
      operation: string;
      targetId: string;
      targetType: string;
    },
  ) {
    const access = await this.requireSpaceAccess(userId, spaceId);

    if (TAG_CREATOR_DENIED_ROLES.has(access.role)) {
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
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireTagGovernanceBySpace(
    userId: string,
    spaceId: string,
    auditContext: {
      metadata: RequestMetadata;
      operation: string;
      targetId: string;
      targetType: string;
    },
  ) {
    const access = await this.requireSpaceAccess(userId, spaceId);

    if (!TAG_GOVERNANCE_ROLES.has(access.role)) {
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
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireTagDeleter(
    userId: string,
    tag: TagDto,
    auditContext: {
      metadata: RequestMetadata;
      operation: string;
      targetId: string;
      targetType: string;
    },
  ) {
    return this.requireTagGovernanceBySpace(userId, tag.spaceId, auditContext);
  }
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function tagInvalidates(): RealtimeInvalidationKey[] {
  return [
    "work-item-list",
    "bug-list",
    "requirement-list",
    "intake-list",
    "version-board",
    "workbench",
    "space-overview",
    "exception-view",
  ];
}

function tagMergeInvalidates(): RealtimeInvalidationKey[] {
  return [
    "work-item-list",
    "bug-list",
    "requirement-list",
    "requirement-detail",
    "intake-list",
    "document-list",
    "document-detail",
    "resource-documents",
    "version-board",
    "workbench",
    "space-overview",
    "timeline",
    "exception-view",
  ];
}

function throwTagNotFound(): never {
  throw new ApiException(
    "TAG_NOT_FOUND",
    "Tag not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwTagInUse(): never {
  throw new ApiException("TAG_IN_USE", "Tag is in use", HttpStatus.CONFLICT);
}
