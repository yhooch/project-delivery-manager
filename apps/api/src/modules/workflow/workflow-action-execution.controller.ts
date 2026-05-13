import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ExecuteActionRequestSchema,
  WorkItemIdPathParamsSchema,
  WorkflowActionIdPathParamsSchema,
  type ExecuteActionRequest,
  type WorkItemDetail,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { getRequestId } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { WorkflowActionExecutionService } from "./workflow-action-execution.service";

@Controller()
@UseGuards(RequireSessionGuard)
export class WorkflowActionExecutionController {
  constructor(
    @Inject(WorkflowActionExecutionService)
    private readonly executions: WorkflowActionExecutionService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Post("work-items/:workItemId/actions/:actionId/execute")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async executeAction(
    @Param(
      new ZodValidationPipe(
        WorkItemIdPathParamsSchema.merge(WorkflowActionIdPathParamsSchema),
      ),
    )
    params: { workItemId: string; actionId: string },
    @Body(new ZodValidationPipe(ExecuteActionRequestSchema))
    body: ExecuteActionRequest,
    @Req() request: RequestWithContext,
  ): Promise<WorkItemDetail> {
    const session = this.currentUser.requireSession(request);

    return this.executions.executeAction(
      session.userId,
      params.workItemId,
      params.actionId,
      body,
      {
        ...getRequestMetadata(request),
        requestId: getRequestId(request),
      },
    );
  }
}
