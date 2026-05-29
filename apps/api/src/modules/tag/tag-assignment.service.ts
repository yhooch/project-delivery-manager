import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  GetTagAssignmentsQuery,
  RealtimeInvalidationKey,
  ReplaceTagAssignmentsRequest,
  TagAssignmentsResponse,
  TagDto,
  TagTargetType,
  WorkItemType,
} from "@project-delivery/shared";

import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import {
  legacyRequirementRealtimeHints,
  withDocumentRequirementInvalidates,
} from "../target/legacy-target-normalizer";
import { TargetResolverService } from "../target/target-resolver.service";
import { TAG_REPOSITORY, type TagRepository } from "./tag.repository";

@Injectable()
export class TagAssignmentService {
  private readonly logger = new Logger(TagAssignmentService.name);

  constructor(
    @Inject(TAG_REPOSITORY)
    private readonly tags: TagRepository,
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
  ) {}

  async get(
    actorUserId: string,
    input: GetTagAssignmentsQuery,
  ): Promise<TagAssignmentsResponse> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
      {
        notFoundCode: "TAG_TARGET_INVALID",
      },
    );
    const tags = await this.tags.listTagsByTarget({
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: input.targetType,
    });

    return {
      targetId: target.targetId,
      targetType: input.targetType,
      tags,
    };
  }

  async replace(
    actorUserId: string,
    input: ReplaceTagAssignmentsRequest,
    metadata: RequestMetadata = {},
  ): Promise<TagAssignmentsResponse> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
      {
        access: "write",
        audit: {
          ...metadata,
          operation: "replaceTagAssignments",
        },
        notFoundCode: "TAG_TARGET_INVALID",
        writePolicy: "objectUpdate",
      },
    );
    const beforeTags = await this.tags.listTagsByTarget({
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: input.targetType,
    });
    const tags = await this.tags.replaceAssignments({
      assignedById: actorUserId,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      tagIds: input.tagIds,
      targetId: target.targetId,
      targetType: input.targetType,
    });

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: { tags },
      before: { tags: beforeTags },
      metadata: {
        operation: "REPLACE_TAG_ASSIGNMENTS",
        tagIds: input.tagIds,
        targetId: input.targetId,
        targetType: input.targetType,
      },
      ...metadata,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: target.targetType,
    });

    if (haveTagAssignmentsChanged(beforeTags, tags)) {
      this.safePublishRealtime({
        actorId: actorUserId,
        organizationId: target.organizationId,
        spaceId: target.spaceId,
        target: { type: target.targetType, id: target.targetId },
        operation: "TAG_CHANGED",
        invalidates: tagAssignmentInvalidates(
          input.targetType,
          target.workItemType,
          target.targetKind === "REQUIREMENT" ? "REQUIREMENT" : undefined,
        ),
        hints: {
          ...legacyRequirementRealtimeHints({
            targetType: target.targetType,
            targetId: target.targetId,
            targetKind:
              target.targetKind === "REQUIREMENT" ? "REQUIREMENT" : undefined,
            spaceId: target.spaceId,
            workItemType: target.workItemType,
          }),
          changedFields: ["tagIds"],
          suggestFullRefresh: true,
        },
      });
    }

    return {
      targetId: target.targetId,
      targetType: input.targetType,
      tags,
    };
  }

  private safePublishRealtime(
    input: Parameters<RealtimePublisherService["publish"]>[0],
  ) {
    try {
      this.realtime.publish(input);
    } catch (error) {
      this.logger.error(
        "Failed to publish tag assignment realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function haveTagAssignmentsChanged(beforeTags: TagDto[], afterTags: TagDto[]) {
  const beforeIds = beforeTags.map((tag) => tag.id).sort();
  const afterIds = afterTags.map((tag) => tag.id).sort();

  if (beforeIds.length !== afterIds.length) {
    return true;
  }

  return beforeIds.some((id, index) => id !== afterIds[index]);
}

function tagAssignmentInvalidates(
  targetType: TagTargetType,
  workItemType: WorkItemType | undefined,
  targetKind?: "REQUIREMENT",
): RealtimeInvalidationKey[] {
  switch (targetType) {
    case "DOCUMENT":
      return withDocumentRequirementInvalidates(
        targetType,
        ["document-list", "document-detail"],
        ["requirement-list", "requirement-detail", "version-board"],
        targetKind,
      );
    case "INTAKE_ITEM":
      return ["intake-list"];
    case "WORK_ITEM":
      return [
        workItemType === "BUG" ? "bug-list" : "work-item-list",
        "version-board",
        "workbench",
        "space-overview",
        "exception-view",
      ];
  }
}
