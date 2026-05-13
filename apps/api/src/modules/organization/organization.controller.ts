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
  AddOrganizationMemberRequestSchema,
  CreateOrganizationRequestSchema,
  ListOrganizationsQuerySchema,
  ListOrganizationMembersQuerySchema,
  MemberIdPathParamsSchema,
  OrganizationIdPathParamsSchema,
  UpdateOrganizationMemberRequestSchema,
  type AddOrganizationMemberRequest,
  type CreateOrganizationRequest,
  type Organization,
  type OrganizationMemberWithUser,
  type PageResult,
  type UpdateOrganizationMemberRequest,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { OrganizationService } from "./organization.service";

@Controller("organizations")
@UseGuards(RequireSessionGuard)
export class OrganizationController {
  constructor(
    @Inject(OrganizationService)
    private readonly organizations: OrganizationService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Body(new ZodValidationPipe(CreateOrganizationRequestSchema))
    body: CreateOrganizationRequest,
    @Req() request: RequestWithContext,
  ): Promise<Organization> {
    const session = this.currentUser.requireSession(request);
    return this.organizations.create(session.userId, body);
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListOrganizationsQuerySchema))
    query: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<Organization>> {
    const session = this.currentUser.requireSession(request);
    return this.organizations.list(session.userId, query);
  }

  @Get(":organizationId/members")
  async listMembers(
    @Param(new ZodValidationPipe(OrganizationIdPathParamsSchema))
    params: { organizationId: string },
    @Query(new ZodValidationPipe(ListOrganizationMembersQuerySchema))
    query: {
      page: number;
      pageSize: number;
      role?: "OWNER" | "ADMIN" | "MEMBER";
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      status?: "ACTIVE" | "DISABLED";
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<OrganizationMemberWithUser>> {
    const session = this.currentUser.requireSession(request);
    return this.organizations.listMembers(
      session.userId,
      params.organizationId,
      query,
    );
  }

  @Post(":organizationId/members")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async addMember(
    @Param(new ZodValidationPipe(OrganizationIdPathParamsSchema))
    params: { organizationId: string },
    @Body(new ZodValidationPipe(AddOrganizationMemberRequestSchema))
    body: AddOrganizationMemberRequest,
    @Req() request: RequestWithContext,
  ): Promise<OrganizationMemberWithUser> {
    const session = this.currentUser.requireSession(request);
    return this.organizations.addMember(
      session.userId,
      params.organizationId,
      body,
    );
  }

  @Patch(":organizationId/members/:memberId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateMember(
    @Param(
      new ZodValidationPipe(
        OrganizationIdPathParamsSchema.merge(MemberIdPathParamsSchema),
      ),
    )
    params: { memberId: string; organizationId: string },
    @Body(new ZodValidationPipe(UpdateOrganizationMemberRequestSchema))
    body: UpdateOrganizationMemberRequest,
    @Req() request: RequestWithContext,
  ): Promise<OrganizationMemberWithUser> {
    const session = this.currentUser.requireSession(request);
    return this.organizations.updateMember(
      session.userId,
      params.organizationId,
      params.memberId,
      body,
    );
  }

  @Get(":organizationId")
  async get(
    @Param(new ZodValidationPipe(OrganizationIdPathParamsSchema))
    params: { organizationId: string },
    @Req() request: RequestWithContext,
  ): Promise<Organization> {
    const session = this.currentUser.requireSession(request);
    return this.organizations.get(session.userId, params.organizationId);
  }
}
