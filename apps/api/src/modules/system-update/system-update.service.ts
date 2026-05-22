import { Inject, Injectable } from "@nestjs/common";
import type {
  CheckUpdateRequest,
  CheckUpdateResponse,
  CreateUpdateJobRequest,
  CreateUpdateJobResponse,
  GetUpdateJobResponse,
  GetUpdateStatusResponse,
  RollbackUpdateJobRequest,
  RollbackUpdateJobResponse,
} from "@project-delivery/shared";

import {
  SYSTEM_UPDATE_CLIENT,
  type SystemUpdateClient,
} from "./system-update.client";

@Injectable()
export class SystemUpdateService {
  constructor(
    @Inject(SYSTEM_UPDATE_CLIENT)
    private readonly client: SystemUpdateClient,
  ) {}

  getStatus(): Promise<GetUpdateStatusResponse> {
    return this.client.getStatus();
  }

  check(request: CheckUpdateRequest): Promise<CheckUpdateResponse> {
    return this.client.check(request);
  }

  createJob(request: CreateUpdateJobRequest): Promise<CreateUpdateJobResponse> {
    return this.client.createJob(request);
  }

  getJob(jobId: string): Promise<GetUpdateJobResponse> {
    return this.client.getJob(jobId);
  }

  rollbackJob(
    jobId: string,
    request: RollbackUpdateJobRequest,
  ): Promise<RollbackUpdateJobResponse> {
    return this.client.rollbackJob(jobId, request);
  }
}
