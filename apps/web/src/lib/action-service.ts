import {
  ExecuteActionRequestSchema,
  GetWorkItemResponseSchema,
  type ExecuteActionRequest,
  type WorkItemDetail,
} from "@project-delivery/shared";

import { apiClient, type ApiRequestInit } from "./api-client";

export type ActionApiTransport = {
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

export type ExecuteActionInput = {
  actionId: string;
  organizationId?: string;
  spaceId: string;
  workItemId: string;
};

const defaultApi: ActionApiTransport = apiClient;

export async function executeAction(
  context: ExecuteActionInput,
  input: ExecuteActionRequest,
  api: ActionApiTransport = defaultApi,
): Promise<WorkItemDetail> {
  const {
    actionId,
    organizationId: _organizationId,
    spaceId: _spaceId,
    workItemId,
  } = context;
  const body = ExecuteActionRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/work-items/${workItemId}/actions/${actionId}/execute`,
    body,
  );

  return GetWorkItemResponseSchema.parse(response.data);
}
