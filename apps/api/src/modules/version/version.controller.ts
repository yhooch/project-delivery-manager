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
  CreateVersionRequestSchema,
  ListVersionsQuerySchema,
  SpaceIdPathParamsSchema,
  UpdateVersionRequestSchema,
  VersionIdPathParamsSchema,
  type CreateVersionRequest,
  type PageResult,
  type UpdateVersionRequest,
  type Version,
  type VersionStatus,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { VersionService } from "./version.service";

@Controller()
@UseGuards(RequireSessionGuard)
export class VersionController {
  constructor(
    @Inject(VersionService)
    private readonly versions: VersionService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/versions")
  async list(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(ListVersionsQuerySchema))
    query: {
      ownerId?: string;
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      status?: VersionStatus;
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<Version>> {
    const session = this.currentUser.requireSession(request);

    return this.versions.list(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/versions")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(CreateVersionRequestSchema))
    body: CreateVersionRequest,
    @Req() request: RequestWithContext,
  ): Promise<Version> {
    const session = this.currentUser.requireSession(request);

    return this.versions.create(session.userId, params.spaceId, body);
  }

  @Get("versions/:versionId")
  async get(
    @Param(new ZodValidationPipe(VersionIdPathParamsSchema))
    params: { versionId: string },
    @Req() request: RequestWithContext,
  ): Promise<Version> {
    const session = this.currentUser.requireSession(request);

    return this.versions.get(session.userId, params.versionId);
  }

  @Patch("versions/:versionId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async update(
    @Param(new ZodValidationPipe(VersionIdPathParamsSchema))
    params: { versionId: string },
    @Body(new ZodValidationPipe(UpdateVersionRequestSchema))
    body: UpdateVersionRequest,
    @Req() request: RequestWithContext,
  ): Promise<Version> {
    const session = this.currentUser.requireSession(request);

    return this.versions.update(session.userId, params.versionId, body);
  }
}
