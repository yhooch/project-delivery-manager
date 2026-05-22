import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  CheckUpdateRequestSchema,
  CreateUpdateJobRequestSchema,
  RollbackUpdateJobRequestSchema,
  UpdateJobIdPathParamsSchema,
  type CheckUpdateRequest,
  type CheckUpdateResponse,
  type CreateUpdateJobRequest,
  type CreateUpdateJobResponse,
  type GetUpdateJobResponse,
  type GetUpdateStatusResponse,
  type RollbackUpdateJobRequest,
  type RollbackUpdateJobResponse,
} from "@project-delivery/shared";

import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { SystemUpdateOperatorGuard } from "./system-update-operator.guard";
import { SystemUpdateService } from "./system-update.service";

@Controller("system/update")
@UseGuards(RequireSessionGuard, SystemUpdateOperatorGuard)
export class SystemUpdateController {
  constructor(private readonly updates: SystemUpdateService) {}

  @Get("status")
  getStatus(): Promise<GetUpdateStatusResponse> {
    return this.updates.getStatus();
  }

  @Post("check")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  check(
    @Body(new ZodValidationPipe(CheckUpdateRequestSchema))
    body: CheckUpdateRequest,
  ): Promise<CheckUpdateResponse> {
    return this.updates.check(body);
  }

  @Post("jobs")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  createJob(
    @Body(new ZodValidationPipe(CreateUpdateJobRequestSchema))
    body: CreateUpdateJobRequest,
  ): Promise<CreateUpdateJobResponse> {
    return this.updates.createJob(body);
  }

  @Get("jobs/:jobId")
  getJob(
    @Param(new ZodValidationPipe(UpdateJobIdPathParamsSchema))
    params: { jobId: string },
  ): Promise<GetUpdateJobResponse> {
    return this.updates.getJob(params.jobId);
  }

  @Post("jobs/:jobId/rollback")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  rollbackJob(
    @Param(new ZodValidationPipe(UpdateJobIdPathParamsSchema))
    params: { jobId: string },
    @Body(new ZodValidationPipe(RollbackUpdateJobRequestSchema))
    body: RollbackUpdateJobRequest,
  ): Promise<RollbackUpdateJobResponse> {
    return this.updates.rollbackJob(params.jobId, body);
  }
}
