import {
  Body,
  Controller,
  Delete,
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
  CreateTagRequestSchema,
  GetTagAssignmentsQuerySchema,
  ListTagsQuerySchema,
  ReplaceTagAssignmentsRequestSchema,
  SpaceIdPathParamsSchema,
  type GetTagAssignmentsQuery,
  TagIdPathParamsSchema,
  type ReplaceTagAssignmentsRequest,
  type TagAssignmentsResponse,
  type CreateTagRequest,
  type ListTagsQuery,
  type PageResult,
  type TagDto,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { TagAssignmentService } from "./tag-assignment.service";
import { TagService } from "./tag.service";

@Controller()
@UseGuards(RequireSessionGuard)
export class TagController {
  constructor(
    @Inject(TagService)
    private readonly tags: TagService,
    @Inject(TagAssignmentService)
    private readonly tagAssignments: TagAssignmentService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/tags")
  async list(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(ListTagsQuerySchema))
    query: ListTagsQuery,
    @Req() request: RequestWithContext,
  ): Promise<PageResult<TagDto>> {
    const session = this.currentUser.requireSession(request);

    return this.tags.list(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/tags")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(CreateTagRequestSchema))
    body: CreateTagRequest,
    @Req() request: RequestWithContext,
  ): Promise<TagDto> {
    const session = this.currentUser.requireSession(request);

    return this.tags.create(
      session.userId,
      params.spaceId,
      body,
      getRequestMetadata(request),
    );
  }

  @Delete("tags/:tagId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async delete(
    @Param(new ZodValidationPipe(TagIdPathParamsSchema))
    params: { tagId: string },
    @Req() request: RequestWithContext,
  ): Promise<Record<string, never>> {
    const session = this.currentUser.requireSession(request);

    return this.tags.delete(
      session.userId,
      params.tagId,
      getRequestMetadata(request),
    );
  }

  @Get("tag-assignments")
  async getAssignments(
    @Query(new ZodValidationPipe(GetTagAssignmentsQuerySchema))
    query: GetTagAssignmentsQuery,
    @Req() request: RequestWithContext,
  ): Promise<TagAssignmentsResponse> {
    const session = this.currentUser.requireSession(request);

    return this.tagAssignments.get(session.userId, query);
  }

  @Patch("tag-assignments")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async replaceAssignments(
    @Body(new ZodValidationPipe(ReplaceTagAssignmentsRequestSchema))
    body: ReplaceTagAssignmentsRequest,
    @Req() request: RequestWithContext,
  ): Promise<TagAssignmentsResponse> {
    const session = this.currentUser.requireSession(request);

    return this.tagAssignments.replace(
      session.userId,
      body,
      getRequestMetadata(request),
    );
  }
}
