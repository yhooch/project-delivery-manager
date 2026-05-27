import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  GetTagAssignmentsQuery,
  RealtimeInvalidationKey,
  ReplaceTagAssignmentsRequest,
  TagAssignmentsResponse,
  TagDto,
  TagTargetType,
  TargetType,
  WorkItemType,
} from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
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
      toTargetType(input.targetType),
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
      toTargetType(input.targetType),
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
        ),
        hints: {
          targetType: target.targetType,
          targetId: target.targetId,
          spaceId: target.spaceId,
          ...(target.workItemType ? { workItemType: target.workItemType } : {}),
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

function toTargetType(targetType: TagTargetType): TargetType {
  switch (targetType) {
    case "REQUIREMENT":
    case "INTAKE_ITEM":
    case "WORK_ITEM":
    case "DOCUMENT":
      return targetType;
  }

  throw new ApiException(
    "TAG_TARGET_INVALID",
    "Tag target type is invalid",
    HttpStatus.BAD_REQUEST,
  );
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
): RealtimeInvalidationKey[] {
  switch (targetType) {
    case "REQUIREMENT":
      return ["requirement-list", "requirement-detail", "version-board"];
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
    case "DOCUMENT":
      return ["document-list", "document-detail"];
  }
}
