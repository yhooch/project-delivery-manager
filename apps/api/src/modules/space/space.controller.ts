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
  AddSpaceMemberRequestSchema,
  CreateSpaceRequestSchema,
  SpaceExceptionsViewQuerySchema,
  SpaceOverviewViewQuerySchema,
  ListSpaceMembersQuerySchema,
  ListSpacesQuerySchema,
  MemberIdPathParamsSchema,
  OrganizationIdPathParamsSchema,
  SpaceIdPathParamsSchema,
  UpdateSpaceMemberRequestSchema,
  UpdateSpaceRequestSchema,
  WorkbenchViewQuerySchema,
  type AddSpaceMemberRequest,
  type CreateSpaceRequest,
  type GetMyWorkbenchViewResponse,
  type GetSpaceExceptionsViewResponse,
  type GetSpaceOverviewViewResponse,
  type PageResult,
  type RecordStatus,
  type Space,
  type SpaceMemberWithUser,
  type SpaceExceptionsViewQuery,
  type SpaceOverviewViewQuery,
  type SpaceRole,
  type SpaceSummary,
  type UpdateSpaceMemberRequest,
  type UpdateSpaceRequest,
  type WorkbenchViewQuery,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { SpaceService } from "./space.service";

@Controller()
@UseGuards(RequireSessionGuard)
export class SpaceController {
  constructor(
    @Inject(SpaceService)
    private readonly spaces: SpaceService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("organizations/:organizationId/spaces")
  async list(
    @Param(new ZodValidationPipe(OrganizationIdPathParamsSchema))
    params: { organizationId: string },
    @Query(new ZodValidationPipe(ListSpacesQuerySchema))
    query: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      status?: RecordStatus;
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<SpaceSummary>> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.list(session.userId, params.organizationId, query);
  }

  @Post("organizations/:organizationId/spaces")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Param(new ZodValidationPipe(OrganizationIdPathParamsSchema))
    params: { organizationId: string },
    @Body(new ZodValidationPipe(CreateSpaceRequestSchema))
    body: CreateSpaceRequest,
    @Req() request: RequestWithContext,
  ): Promise<Space> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.create(
      session.userId,
      params.organizationId,
      body,
      getRequestMetadata(request),
    );
  }

  @Get("spaces/:spaceId")
  async get(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Req() request: RequestWithContext,
  ): Promise<Space> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.get(session.userId, params.spaceId);
  }

  @Patch("spaces/:spaceId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async update(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(UpdateSpaceRequestSchema))
    body: UpdateSpaceRequest,
    @Req() request: RequestWithContext,
  ): Promise<Space> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.update(
      session.userId,
      params.spaceId,
      body,
      getRequestMetadata(request),
    );
  }

  @Get("views/spaces/:spaceId/overview")
  async overview(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(SpaceOverviewViewQuerySchema))
    query: SpaceOverviewViewQuery,
    @Req() request: RequestWithContext,
  ): Promise<GetSpaceOverviewViewResponse> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.getOverview(session.userId, params.spaceId, query);
  }

  @Get("views/spaces/:spaceId/exceptions")
  async exceptions(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(SpaceExceptionsViewQuerySchema))
    query: SpaceExceptionsViewQuery,
    @Req() request: RequestWithContext,
  ): Promise<GetSpaceExceptionsViewResponse> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.getExceptions(session.userId, params.spaceId, query);
  }

  @Get("views/my-workbench")
  async myWorkbench(
    @Query(new ZodValidationPipe(WorkbenchViewQuerySchema))
    query: WorkbenchViewQuery,
    @Req() request: RequestWithContext,
  ): Promise<GetMyWorkbenchViewResponse> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.getMyWorkbench(session.userId, query);
  }

  @Get("spaces/:spaceId/members")
  async listMembers(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(ListSpaceMembersQuerySchema))
    query: {
      page: number;
      pageSize: number;
      role?: SpaceRole;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      status?: RecordStatus;
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<SpaceMemberWithUser>> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.listMembers(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/members")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async addMember(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(AddSpaceMemberRequestSchema))
    body: AddSpaceMemberRequest,
    @Req() request: RequestWithContext,
  ): Promise<SpaceMemberWithUser> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.addMember(
      session.userId,
      params.spaceId,
      body,
      getRequestMetadata(request),
    );
  }

  @Patch("spaces/:spaceId/members/:memberId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateMember(
    @Param(
      new ZodValidationPipe(
        SpaceIdPathParamsSchema.merge(MemberIdPathParamsSchema),
      ),
    )
    params: { memberId: string; spaceId: string },
    @Body(new ZodValidationPipe(UpdateSpaceMemberRequestSchema))
    body: UpdateSpaceMemberRequest,
    @Req() request: RequestWithContext,
  ): Promise<SpaceMemberWithUser> {
    const session = this.currentUser.requireSession(request);

    return this.spaces.updateMember(
      session.userId,
      params.spaceId,
      params.memberId,
      body,
      getRequestMetadata(request),
    );
  }
}
