import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  GetTagAssignmentsQuery,
  ReplaceTagAssignmentsRequest,
  TagAssignmentsResponse,
  TagTargetType,
  TargetType,
} from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import type { RequestMetadata } from "../auth/auth-session.types";
import { TargetResolverService } from "../target/target-resolver.service";
import { TAG_REPOSITORY, type TagRepository } from "./tag.repository";

@Injectable()
export class TagAssignmentService {
  constructor(
    @Inject(TAG_REPOSITORY)
    private readonly tags: TagRepository,
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
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
      },
    );
    const tags = await this.tags.replaceAssignments({
      assignedById: actorUserId,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      tagIds: input.tagIds,
      targetId: target.targetId,
      targetType: input.targetType,
    });

    return {
      targetId: target.targetId,
      targetType: input.targetType,
      tags,
    };
  }
}

function toTargetType(targetType: TagTargetType): TargetType {
  switch (targetType) {
    case "REQUIREMENT":
    case "INTAKE_ITEM":
    case "WORK_ITEM":
      return targetType;
  }

  throw new ApiException(
    "TAG_TARGET_INVALID",
    "Tag target type is invalid",
    HttpStatus.BAD_REQUEST,
  );
}
