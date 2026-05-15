import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CreateWorkItemRequestSchema,
  SpaceIdPathParamsSchema,
  UpdateWorkItemRequestSchema,
  WorkItemIdPathParamsSchema,
  WorkItemListQuerySchema,
  type CreateWorkItemRequest,
  type ListWorkItemsResponse,
  type Priority,
  type StatusCategory,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemDetail,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { WorkItemService } from "./workitem.service";

@Controller()
@UseGuards(RequireSessionGuard)
export class WorkItemController {
  constructor(
    @Inject(WorkItemService)
    private readonly workItems: WorkItemService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/work-items")
  async list(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(WorkItemListQuerySchema))
    query: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      type?: "TASK";
      versionId?: string;
      requirementId?: string;
      intakeItemId?: string;
      reporterId?: string;
      assigneeId?: string;
      statusCategory?: StatusCategory;
      priority?: Priority;
    },
    @Req() request: RequestWithContext,
  ): Promise<ListWorkItemsResponse> {
    const session = this.currentUser.requireSession(request);

    return this.workItems.list(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/work-items")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(CreateWorkItemRequestSchema))
    body: CreateWorkItemRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkItem> {
    const session = this.currentUser.requireSession(request);

    return this.workItems.create(
      session.userId,
      params.spaceId,
      body,
      getRequestMetadata(request),
    );
  }

  @Get("work-items/:workItemId")
  async get(
    @Param(new ZodValidationPipe(WorkItemIdPathParamsSchema))
    params: { workItemId: string },
    @Req() request: RequestWithContext,
  ): Promise<WorkItemDetail> {
    const session = this.currentUser.requireSession(request);

    return this.workItems.get(session.userId, params.workItemId);
  }

  @Patch("work-items/:workItemId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async update(
    @Param(new ZodValidationPipe(WorkItemIdPathParamsSchema))
    params: { workItemId: string },
    @Body(new ZodValidationPipe(UpdateWorkItemRequestSchema))
    body: UpdateWorkItemRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkItem> {
    const session = this.currentUser.requireSession(request);

    return this.workItems.update(
      session.userId,
      params.workItemId,
      body,
      getRequestMetadata(request),
    );
  }
}
