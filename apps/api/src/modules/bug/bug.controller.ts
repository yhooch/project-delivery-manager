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
  BugListQuerySchema,
  CreateBugRequestSchema,
  IdPathParamsSchema,
  SpaceIdPathParamsSchema,
  UpdateBugRequestSchema,
  type BugSeverity,
  type BugView,
  type CreateBugRequest,
  type PageResult,
  type Priority,
  type StatusCategory,
  type UpdateBugRequest,
} from "@project-delivery/shared";

import { getRequestId, type RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { BugService } from "./bug.service";

@Controller()
@UseGuards(RequireSessionGuard)
export class BugController {
  constructor(
    @Inject(BugService)
    private readonly bugs: BugService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/bugs")
  async list(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(BugListQuerySchema))
    query: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      type?: "BUG";
      versionId?: string;
      requirementId?: string;
      intakeItemId?: string;
      reporterId?: string;
      assigneeId?: string;
      statusCategory?: StatusCategory;
      priority?: Priority;
      severity?: BugSeverity;
      relatedTaskId?: string;
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<BugView>> {
    const session = this.currentUser.requireSession(request);

    return this.bugs.list(
      session.userId,
      params.spaceId,
      query,
      getAuditMetadata(request),
    );
  }

  @Post("spaces/:spaceId/bugs")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(CreateBugRequestSchema))
    body: CreateBugRequest,
    @Req() request: RequestWithContext,
  ): Promise<BugView> {
    const session = this.currentUser.requireSession(request);

    return this.bugs.create(
      session.userId,
      params.spaceId,
      body,
      getAuditMetadata(request),
    );
  }

  @Get("bugs/:id")
  async get(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Req() request: RequestWithContext,
  ): Promise<BugView> {
    const session = this.currentUser.requireSession(request);

    return this.bugs.get(session.userId, params.id, getAuditMetadata(request));
  }

  @Patch("bugs/:id")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async update(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Body(new ZodValidationPipe(UpdateBugRequestSchema))
    body: UpdateBugRequest,
    @Req() request: RequestWithContext,
  ): Promise<BugView> {
    const session = this.currentUser.requireSession(request);

    return this.bugs.update(
      session.userId,
      params.id,
      body,
      getAuditMetadata(request),
    );
  }
}

function getAuditMetadata(request: RequestWithContext) {
  return {
    ...getRequestMetadata(request),
    requestId: getRequestId(request),
  };
}
