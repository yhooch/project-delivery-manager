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
  ConvertIntakeItemToWorkItemsRequestSchema,
  CreateIntakeItemRequestSchema,
  EmptyObjectSchema,
  IdPathParamsSchema,
  IntakeItemListQuerySchema,
  SpaceIdPathParamsSchema,
  UpdateIntakeItemRequestSchema,
  type ConvertIntakeItemToWorkItemsRequest,
  type ConvertIntakeItemToWorkItemsResponse,
  type CreateIntakeItemRequest,
  type IntakeItem,
  type IntakeSourceType,
  type IntakeStatus,
  type ListIntakeItemsResponse,
  type Priority,
  type TagMatch,
  type UpdateIntakeItemRequest,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { IntakeService } from "./intake.service";

const OptionalEmptyObjectSchema = EmptyObjectSchema.optional().transform(
  () => ({}),
);

@Controller()
@UseGuards(RequireSessionGuard)
export class IntakeController {
  constructor(
    @Inject(IntakeService)
    private readonly intakeItems: IntakeService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/intake-items")
  async list(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(IntakeItemListQuerySchema))
    query: {
      assigneeId?: string;
      page: number;
      pageSize: number;
      priority?: Priority;
      query?: string;
      reporterId?: string;
      requirementId?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      sourceType?: IntakeSourceType;
      status?: IntakeStatus;
      tagIds?: string;
      tagMatch?: TagMatch;
      versionId?: string;
    },
    @Req() request: RequestWithContext,
  ): Promise<ListIntakeItemsResponse> {
    const session = this.currentUser.requireSession(request);

    return this.intakeItems.list(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/intake-items")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(CreateIntakeItemRequestSchema))
    body: CreateIntakeItemRequest,
    @Req() request: RequestWithContext,
  ): Promise<IntakeItem> {
    const session = this.currentUser.requireSession(request);

    return this.intakeItems.create(
      session.userId,
      params.spaceId,
      body,
      getRequestMetadata(request),
    );
  }

  @Get("intake-items/:id")
  async get(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Req() request: RequestWithContext,
  ): Promise<IntakeItem> {
    const session = this.currentUser.requireSession(request);

    return this.intakeItems.get(session.userId, params.id);
  }

  @Patch("intake-items/:id")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async update(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Body(new ZodValidationPipe(UpdateIntakeItemRequestSchema))
    body: UpdateIntakeItemRequest,
    @Req() request: RequestWithContext,
  ): Promise<IntakeItem> {
    const session = this.currentUser.requireSession(request);

    return this.intakeItems.update(
      session.userId,
      params.id,
      body,
      getRequestMetadata(request),
    );
  }

  @Post("intake-items/:id/accept")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async accept(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Body(new ZodValidationPipe(OptionalEmptyObjectSchema))
    _body: Record<string, never>,
    @Req() request: RequestWithContext,
  ): Promise<IntakeItem> {
    const session = this.currentUser.requireSession(request);

    return this.intakeItems.accept(
      session.userId,
      params.id,
      getRequestMetadata(request),
    );
  }

  @Post("intake-items/:id/defer")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async defer(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Body(new ZodValidationPipe(OptionalEmptyObjectSchema))
    _body: Record<string, never>,
    @Req() request: RequestWithContext,
  ): Promise<IntakeItem> {
    const session = this.currentUser.requireSession(request);

    return this.intakeItems.defer(
      session.userId,
      params.id,
      getRequestMetadata(request),
    );
  }

  @Post("intake-items/:id/reject")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async reject(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Body(new ZodValidationPipe(OptionalEmptyObjectSchema))
    _body: Record<string, never>,
    @Req() request: RequestWithContext,
  ): Promise<IntakeItem> {
    const session = this.currentUser.requireSession(request);

    return this.intakeItems.reject(
      session.userId,
      params.id,
      getRequestMetadata(request),
    );
  }

  @Post("intake-items/:id/convert-to-work-items")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async convertToWorkItems(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Body(new ZodValidationPipe(ConvertIntakeItemToWorkItemsRequestSchema))
    body: ConvertIntakeItemToWorkItemsRequest,
    @Req() request: RequestWithContext,
  ): Promise<ConvertIntakeItemToWorkItemsResponse> {
    const session = this.currentUser.requireSession(request);

    return this.intakeItems.convertToWorkItems(
      session.userId,
      params.id,
      body,
      getRequestMetadata(request),
    );
  }
}
