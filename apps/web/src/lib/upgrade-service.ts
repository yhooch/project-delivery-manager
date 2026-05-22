import {
  CheckUpdateRequestSchema,
  CheckUpdateResponseSchema,
  CreateUpdateJobRequestSchema,
  CreateUpdateJobResponseSchema,
  GetUpdateJobResponseSchema,
  GetUpdateStatusResponseSchema,
  RollbackUpdateJobResponseSchema,
  type CheckUpdateRequest,
  type CheckUpdateResponse,
  type CreateUpdateJobRequest,
  type CreateUpdateJobResponse,
  type GetUpdateJobResponse,
  type GetUpdateStatusResponse,
  type RollbackUpdateJobResponse,
} from "@project-delivery/shared";

import { apiClient, type ApiRequestInit } from "./api-client";

export type UpgradeApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

const defaultApi: UpgradeApiTransport = apiClient;

type CheckUpdateInput = Partial<CheckUpdateRequest>;

export async function getUpdateStatus(
  api: UpgradeApiTransport = defaultApi,
): Promise<GetUpdateStatusResponse> {
  const response = await api.get<GetUpdateStatusResponse>(
    "/system/update/status",
  );

  return GetUpdateStatusResponseSchema.parse(response.data);
}

export async function checkUpdate(
  input: CheckUpdateInput = {},
  api: UpgradeApiTransport = defaultApi,
): Promise<CheckUpdateResponse> {
  const body = CheckUpdateRequestSchema.parse(input);
  const response = await api.post<CheckUpdateResponse>(
    "/system/update/check",
    body,
  );

  return CheckUpdateResponseSchema.parse(response.data);
}

export async function createUpdateJob(
  input: CreateUpdateJobRequest,
  api: UpgradeApiTransport = defaultApi,
): Promise<CreateUpdateJobResponse> {
  const body = CreateUpdateJobRequestSchema.parse(input);
  const response = await api.post<CreateUpdateJobResponse>(
    "/system/update/jobs",
    body,
  );

  return CreateUpdateJobResponseSchema.parse(response.data);
}

export async function getUpdateJob(
  jobId: string,
  api: UpgradeApiTransport = defaultApi,
): Promise<GetUpdateJobResponse> {
  const response = await api.get<GetUpdateJobResponse>(
    `/system/update/jobs/${encodeURIComponent(jobId)}`,
  );

  return GetUpdateJobResponseSchema.parse(response.data);
}

export async function rollbackUpdateJob(
  jobId: string,
  api: UpgradeApiTransport = defaultApi,
): Promise<RollbackUpdateJobResponse> {
  const response = await api.post<RollbackUpdateJobResponse>(
    `/system/update/jobs/${encodeURIComponent(jobId)}/rollback`,
    {},
  );

  return RollbackUpdateJobResponseSchema.parse(response.data);
}
