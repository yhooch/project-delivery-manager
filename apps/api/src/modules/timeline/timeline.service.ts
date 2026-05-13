import { Inject, Injectable } from "@nestjs/common";
import type {
  PageResult,
  TargetType,
  TimelineEvent,
} from "@project-delivery/shared";

import { TargetResolverService } from "../target/target-resolver.service";
import {
  TIMELINE_REPOSITORY,
  type TimelineRepository,
} from "./timeline.repository";

@Injectable()
export class TimelineService {
  constructor(
    @Inject(TIMELINE_REPOSITORY)
    private readonly timelines: TimelineRepository,
    @Inject(TargetResolverService)
    private readonly targets: TargetResolverService,
  ) {}

  async list(
    actorUserId: string,
    input: {
      page: number;
      pageSize: number;
      targetId: string;
      targetType: TargetType;
    },
  ): Promise<PageResult<TimelineEvent>> {
    const target = await this.targets.resolve(
      actorUserId,
      input.targetType,
      input.targetId,
    );

    return this.timelines.listByTarget({
      organizationId: target.organizationId,
      page: input.page,
      pageSize: input.pageSize,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetTitle: target.title,
      targetType: target.targetType,
    });
  }

  async listWorkItem(
    actorUserId: string,
    workItemId: string,
    input: {
      page: number;
      pageSize: number;
    },
  ): Promise<PageResult<TimelineEvent>> {
    return this.list(actorUserId, {
      page: input.page,
      pageSize: input.pageSize,
      targetId: workItemId,
      targetType: "WORK_ITEM",
    });
  }
}
