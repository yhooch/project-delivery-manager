import { Controller, Get, Inject, Param, Query, Req, UseGuards } from "@nestjs/common";
import {
  TimelineQuerySchema,
  WorkItemIdPathParamsSchema,
  WorkItemTimelineQuerySchema,
  type PageResult,
  type TargetType,
  type TimelineEvent,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { TimelineService } from "./timeline.service";

@Controller()
@UseGuards(RequireSessionGuard)
export class TimelineController {
  constructor(
    @Inject(TimelineService)
    private readonly timelines: TimelineService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("timeline")
  async list(
    @Query(new ZodValidationPipe(TimelineQuerySchema))
    query: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      targetId: string;
      targetType: TargetType;
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<TimelineEvent>> {
    const session = this.currentUser.requireSession(request);

    return this.timelines.list(session.userId, query);
  }

  @Get("work-items/:workItemId/timeline")
  async listWorkItem(
    @Param(new ZodValidationPipe(WorkItemIdPathParamsSchema))
    params: { workItemId: string },
    @Query(new ZodValidationPipe(WorkItemTimelineQuerySchema))
    query: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<TimelineEvent>> {
    const session = this.currentUser.requireSession(request);

    return this.timelines.listWorkItem(
      session.userId,
      params.workItemId,
      query,
    );
  }
}
