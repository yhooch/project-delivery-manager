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
  ActionFormFieldIdPathParamsSchema,
  CreateActionFormFieldRequestSchema,
  CreateWorkflowActionRequestSchema,
  CreateWorkflowBindingRequestSchema,
  CreateWorkflowDefinitionRequestSchema,
  CreateWorkflowStateRequestSchema,
  CreateWorkflowVersionRequestSchema,
  EmptyObjectSchema,
  IdPathParamsSchema,
  ListWorkflowBindingsQuerySchema,
  ListWorkflowsQuerySchema,
  ListWorkflowVersionsQuerySchema,
  PublishWorkflowVersionRequestSchema,
  SpaceIdPathParamsSchema,
  UpdateActionFormFieldRequestSchema,
  UpdateWorkflowActionRequestSchema,
  UpdateWorkflowBindingRequestSchema,
  UpdateWorkflowDefinitionRequestSchema,
  UpdateWorkflowStateRequestSchema,
  UpdateWorkflowVersionRequestSchema,
  WorkflowActionIdPathParamsSchema,
  WorkflowIdPathParamsSchema,
  WorkflowStateIdPathParamsSchema,
  WorkflowVersionIdPathParamsSchema,
  type ActionFormFieldSummary,
  type PageResult,
  type WorkflowActionConfigSummary,
  type WorkflowBinding,
  type WorkflowDefinition,
  type WorkflowState,
  type WorkflowVersion,
} from "@project-delivery/shared";
import type { z } from "zod";

import {
  firstHeaderValue,
  getRequestId,
  type RequestWithContext,
} from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import {
  WorkflowConfigService,
  type WorkflowConfigRequestMetadata,
} from "./workflow-config.service";

type ListWorkflowsQuery = z.infer<typeof ListWorkflowsQuerySchema>;
type ListWorkflowVersionsQuery = z.infer<typeof ListWorkflowVersionsQuerySchema>;
type ListWorkflowBindingsQuery = z.infer<
  typeof ListWorkflowBindingsQuerySchema
>;
type CreateWorkflowDefinitionRequest = z.infer<
  typeof CreateWorkflowDefinitionRequestSchema
>;
type UpdateWorkflowDefinitionRequest = z.infer<
  typeof UpdateWorkflowDefinitionRequestSchema
>;
type CreateWorkflowVersionRequest = z.infer<
  typeof CreateWorkflowVersionRequestSchema
>;
type UpdateWorkflowVersionRequest = z.infer<
  typeof UpdateWorkflowVersionRequestSchema
>;
type CreateWorkflowStateRequest = z.infer<typeof CreateWorkflowStateRequestSchema>;
type UpdateWorkflowStateRequest = z.infer<typeof UpdateWorkflowStateRequestSchema>;
type CreateWorkflowActionRequest = z.infer<
  typeof CreateWorkflowActionRequestSchema
>;
type UpdateWorkflowActionRequest = z.infer<
  typeof UpdateWorkflowActionRequestSchema
>;
type CreateActionFormFieldRequest = z.infer<
  typeof CreateActionFormFieldRequestSchema
>;
type UpdateActionFormFieldRequest = z.infer<
  typeof UpdateActionFormFieldRequestSchema
>;
type CreateWorkflowBindingRequest = z.infer<
  typeof CreateWorkflowBindingRequestSchema
>;
type UpdateWorkflowBindingRequest = z.infer<
  typeof UpdateWorkflowBindingRequestSchema
>;

@Controller()
@UseGuards(RequireSessionGuard)
export class WorkflowConfigController {
  constructor(
    @Inject(WorkflowConfigService)
    private readonly workflows: WorkflowConfigService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("spaces/:spaceId/workflows")
  async listDefinitions(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(ListWorkflowsQuerySchema))
    query: ListWorkflowsQuery,
    @Req() request: RequestWithContext,
  ): Promise<PageResult<WorkflowDefinition>> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.listDefinitions(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/workflows")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async createDefinition(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(CreateWorkflowDefinitionRequestSchema))
    body: CreateWorkflowDefinitionRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowDefinition> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.createDefinition(
      session.userId,
      params.spaceId,
      body,
      requestMetadata(request),
    );
  }

  @Get("workflows/:workflowId")
  async getDefinition(
    @Param(new ZodValidationPipe(WorkflowIdPathParamsSchema))
    params: { workflowId: string },
    @Req() request: RequestWithContext,
  ): Promise<WorkflowDefinition> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.getDefinition(session.userId, params.workflowId);
  }

  @Patch("workflows/:workflowId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateDefinition(
    @Param(new ZodValidationPipe(WorkflowIdPathParamsSchema))
    params: { workflowId: string },
    @Body(new ZodValidationPipe(UpdateWorkflowDefinitionRequestSchema))
    body: UpdateWorkflowDefinitionRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowDefinition> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.updateDefinition(
      session.userId,
      params.workflowId,
      body,
      requestMetadata(request),
    );
  }

  @Get("workflows/:workflowId/versions")
  async listVersions(
    @Param(new ZodValidationPipe(WorkflowIdPathParamsSchema))
    params: { workflowId: string },
    @Query(new ZodValidationPipe(ListWorkflowVersionsQuerySchema))
    query: ListWorkflowVersionsQuery,
    @Req() request: RequestWithContext,
  ): Promise<PageResult<WorkflowVersion>> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.listVersions(
      session.userId,
      params.workflowId,
      query,
    );
  }

  @Post("workflows/:workflowId/versions")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async createVersion(
    @Param(new ZodValidationPipe(WorkflowIdPathParamsSchema))
    params: { workflowId: string },
    @Body(new ZodValidationPipe(CreateWorkflowVersionRequestSchema))
    body: CreateWorkflowVersionRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowVersion> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.createVersion(
      session.userId,
      params.workflowId,
      body,
      requestMetadata(request),
    );
  }

  @Get("workflow-versions/:workflowVersionId")
  async getVersion(
    @Param(new ZodValidationPipe(WorkflowVersionIdPathParamsSchema))
    params: { workflowVersionId: string },
    @Req() request: RequestWithContext,
  ): Promise<WorkflowVersion> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.getVersion(session.userId, params.workflowVersionId);
  }

  @Patch("workflow-versions/:workflowVersionId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateVersion(
    @Param(new ZodValidationPipe(WorkflowVersionIdPathParamsSchema))
    params: { workflowVersionId: string },
    @Body(new ZodValidationPipe(UpdateWorkflowVersionRequestSchema))
    body: UpdateWorkflowVersionRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowVersion> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.updateVersion(
      session.userId,
      params.workflowVersionId,
      body,
      requestMetadata(request),
    );
  }

  @Post("workflow-versions/:workflowVersionId/publish")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async publishVersion(
    @Param(new ZodValidationPipe(WorkflowVersionIdPathParamsSchema))
    params: { workflowVersionId: string },
    @Body(new ZodValidationPipe(PublishWorkflowVersionRequestSchema))
    _body: z.infer<typeof EmptyObjectSchema>,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowVersion> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.publishVersion(
      session.userId,
      params.workflowVersionId,
      requestMetadata(request),
    );
  }

  @Post("workflow-versions/:workflowVersionId/states")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async createState(
    @Param(new ZodValidationPipe(WorkflowVersionIdPathParamsSchema))
    params: { workflowVersionId: string },
    @Body(new ZodValidationPipe(CreateWorkflowStateRequestSchema))
    body: CreateWorkflowStateRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowState> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.createState(
      session.userId,
      params.workflowVersionId,
      body,
      requestMetadata(request),
    );
  }

  @Patch("workflow-states/:stateId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateState(
    @Param(new ZodValidationPipe(WorkflowStateIdPathParamsSchema))
    params: { stateId: string },
    @Body(new ZodValidationPipe(UpdateWorkflowStateRequestSchema))
    body: UpdateWorkflowStateRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowState> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.updateState(
      session.userId,
      params.stateId,
      body,
      requestMetadata(request),
    );
  }

  @Delete("workflow-states/:stateId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async deleteState(
    @Param(new ZodValidationPipe(WorkflowStateIdPathParamsSchema))
    params: { stateId: string },
    @Req() request: RequestWithContext,
  ): Promise<Record<string, never>> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.deleteState(
      session.userId,
      params.stateId,
      requestMetadata(request),
    );
  }

  @Post("workflow-versions/:workflowVersionId/actions")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async createAction(
    @Param(new ZodValidationPipe(WorkflowVersionIdPathParamsSchema))
    params: { workflowVersionId: string },
    @Body(new ZodValidationPipe(CreateWorkflowActionRequestSchema))
    body: CreateWorkflowActionRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowActionConfigSummary> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.createAction(
      session.userId,
      params.workflowVersionId,
      body,
      requestMetadata(request),
    );
  }

  @Patch("workflow-actions/:actionId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateAction(
    @Param(new ZodValidationPipe(WorkflowActionIdPathParamsSchema))
    params: { actionId: string },
    @Body(new ZodValidationPipe(UpdateWorkflowActionRequestSchema))
    body: UpdateWorkflowActionRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowActionConfigSummary> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.updateAction(
      session.userId,
      params.actionId,
      body,
      requestMetadata(request),
    );
  }

  @Delete("workflow-actions/:actionId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async deleteAction(
    @Param(new ZodValidationPipe(WorkflowActionIdPathParamsSchema))
    params: { actionId: string },
    @Req() request: RequestWithContext,
  ): Promise<Record<string, never>> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.deleteAction(
      session.userId,
      params.actionId,
      requestMetadata(request),
    );
  }

  @Post("workflow-actions/:actionId/form-fields")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async createFormField(
    @Param(new ZodValidationPipe(WorkflowActionIdPathParamsSchema))
    params: { actionId: string },
    @Body(new ZodValidationPipe(CreateActionFormFieldRequestSchema))
    body: CreateActionFormFieldRequest,
    @Req() request: RequestWithContext,
  ): Promise<ActionFormFieldSummary> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.createFormField(
      session.userId,
      params.actionId,
      body,
      requestMetadata(request),
    );
  }

  @Patch("action-form-fields/:fieldId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateFormField(
    @Param(new ZodValidationPipe(ActionFormFieldIdPathParamsSchema))
    params: { fieldId: string },
    @Body(new ZodValidationPipe(UpdateActionFormFieldRequestSchema))
    body: UpdateActionFormFieldRequest,
    @Req() request: RequestWithContext,
  ): Promise<ActionFormFieldSummary> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.updateFormField(
      session.userId,
      params.fieldId,
      body,
      requestMetadata(request),
    );
  }

  @Delete("action-form-fields/:fieldId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async deleteFormField(
    @Param(new ZodValidationPipe(ActionFormFieldIdPathParamsSchema))
    params: { fieldId: string },
    @Req() request: RequestWithContext,
  ): Promise<Record<string, never>> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.deleteFormField(
      session.userId,
      params.fieldId,
      requestMetadata(request),
    );
  }

  @Get("spaces/:spaceId/workflow-bindings")
  async listBindings(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Query(new ZodValidationPipe(ListWorkflowBindingsQuerySchema))
    query: ListWorkflowBindingsQuery,
    @Req() request: RequestWithContext,
  ): Promise<PageResult<WorkflowBinding>> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.listBindings(session.userId, params.spaceId, query);
  }

  @Post("spaces/:spaceId/workflow-bindings")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async createBinding(
    @Param(new ZodValidationPipe(SpaceIdPathParamsSchema))
    params: { spaceId: string },
    @Body(new ZodValidationPipe(CreateWorkflowBindingRequestSchema))
    body: CreateWorkflowBindingRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowBinding> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.createBinding(
      session.userId,
      params.spaceId,
      body,
      requestMetadata(request),
    );
  }

  @Patch("workflow-bindings/:id")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async updateBinding(
    @Param(new ZodValidationPipe(IdPathParamsSchema))
    params: { id: string },
    @Body(new ZodValidationPipe(UpdateWorkflowBindingRequestSchema))
    body: UpdateWorkflowBindingRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkflowBinding> {
    const session = this.currentUser.requireSession(request);

    return this.workflows.updateBinding(
      session.userId,
      params.id,
      body,
      requestMetadata(request),
    );
  }
}

function requestMetadata(
  request: RequestWithContext,
): WorkflowConfigRequestMetadata {
  return {
    ip: request.ip ?? request.socket?.remoteAddress,
    requestId: getRequestId(request),
    userAgent: firstHeaderValue(request.headers?.["user-agent"]),
  };
}
