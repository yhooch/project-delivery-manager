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
  CreateRequirementDraftRequestSchema,
  RequirementIdPathParamsSchema,
  RequirementListQuerySchema,
  SpaceIdPathParamsSchema,
  UpdateRequirementRequestSchema,
  type CreateRequirementDraftRequest,
  type PageResult,
  type Requirement,
  type RequirementStatus,
  type UpdateRequirementRequest,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { RequirementService } from "./requirement.service";

const OptionalCreateRequirementDraftRequestSchema =
  CreateRequirementDraftRequestSchema.optional().transform((value) => value ?? {});

@Controller()
@UseGuards(RequireSessionGuard)
export class RequirementController {
  constructor(
    @Inject(RequirementService)
    private readonly requirements: RequirementService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/requirements")
  async list(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(RequirementListQuerySchema))
    query: {
      includeDrafts?: boolean;
      ownerId?: string;
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      status?: RequirementStatus;
      versionId?: string;
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<Requirement>> {
    const session = this.currentUser.requireSession(request);

    return this.requirements.list(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/requirements")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async createDraft(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(OptionalCreateRequirementDraftRequestSchema))
    body: CreateRequirementDraftRequest,
    @Req() request: RequestWithContext,
  ): Promise<Requirement> {
    const session = this.currentUser.requireSession(request);

    return this.requirements.createDraft(session.userId, params.spaceId, body);
  }

  @Get("requirements/:requirementId")
  async get(
    @Param(new ZodValidationPipe(RequirementIdPathParamsSchema))
    params: { requirementId: string },
    @Req() request: RequestWithContext,
  ): Promise<Requirement> {
    const session = this.currentUser.requireSession(request);

    return this.requirements.get(session.userId, params.requirementId);
  }

  @Patch("requirements/:requirementId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async update(
    @Param(new ZodValidationPipe(RequirementIdPathParamsSchema))
    params: { requirementId: string },
    @Body(new ZodValidationPipe(UpdateRequirementRequestSchema))
    body: UpdateRequirementRequest,
    @Req() request: RequestWithContext,
  ): Promise<Requirement> {
    const session = this.currentUser.requireSession(request);

    return this.requirements.update(session.userId, params.requirementId, body);
  }

  @Delete("requirements/:requirementId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async deleteDraft(
    @Param(new ZodValidationPipe(RequirementIdPathParamsSchema))
    params: { requirementId: string },
    @Req() request: RequestWithContext,
  ): Promise<Record<string, never>> {
    const session = this.currentUser.requireSession(request);

    await this.requirements.deleteDraft(session.userId, params.requirementId);

    return {};
  }
}
