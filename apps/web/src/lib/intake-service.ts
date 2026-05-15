import {
  AcceptIntakeItemResponseSchema,
  ConvertIntakeItemToWorkItemsRequestSchema,
  ConvertIntakeItemToWorkItemsResponseSchema,
  CreateIntakeItemRequestSchema,
  CreateIntakeItemResponseSchema,
  DeferIntakeItemResponseSchema,
  GetIntakeItemResponseSchema,
  IntakeItemListQuerySchema,
  RejectIntakeItemResponseSchema,
  UpdateIntakeItemRequestSchema,
  UpdateIntakeItemResponseSchema,
  ListIntakeItemsResponseSchema,
  type ConvertIntakeItemToWorkItemsRequest,
  type ConvertIntakeItemToWorkItemsResponse,
  type CreateIntakeItemRequest,
  type IntakeItem,
  type IntakeSourceType,
  type IntakeStatus,
  type ListIntakeItemsResponse,
  type Priority,
  type UpdateIntakeItemRequest,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";

export type IntakeApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  patch<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

export type ListIntakeItemsInput = z.input<typeof IntakeItemListQuerySchema> & {
  organizationId?: string;
  spaceId: string;
};

export type IntakeItemIdentityInput = {
  intakeItemId: string;
  organizationId?: string;
  spaceId?: string;
};

export type CreateIntakeItemInput = CreateIntakeItemRequest;
export type UpdateIntakeItemInput = UpdateIntakeItemRequest;
export type ConvertIntakeItemInput = ConvertIntakeItemToWorkItemsRequest;

export type IntakeListFilterState = {
  assigneeId?: string;
  priority?: Priority;
  reporterId?: string;
  requirementId?: string;
  sourceType?: IntakeSourceType;
  status?: IntakeStatus;
  versionId?: string;
};

const defaultApi: IntakeApiTransport = apiClient;

export async function listIntakeItems(
  input: ListIntakeItemsInput,
  api: IntakeApiTransport = defaultApi,
): Promise<ListIntakeItemsResponse> {
  const { organizationId: _organizationId, spaceId, ...filters } = input;
  const query = IntakeItemListQuerySchema.parse(filters);
  const response = await api.get<unknown>(`/spaces/${spaceId}/intake-items`, {
    query,
  });

  return ListIntakeItemsResponseSchema.parse(response.data);
}

export async function createIntakeItem(
  context: { organizationId?: string; spaceId: string },
  input: CreateIntakeItemInput,
  api: IntakeApiTransport = defaultApi,
): Promise<IntakeItem> {
  const { organizationId: _organizationId, spaceId } = context;
  const body = CreateIntakeItemRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/spaces/${spaceId}/intake-items`,
    body,
  );

  return CreateIntakeItemResponseSchema.parse(response.data);
}

export async function getIntakeItem(
  input: IntakeItemIdentityInput,
  api: IntakeApiTransport = defaultApi,
): Promise<IntakeItem> {
  const {
    intakeItemId,
    organizationId: _organizationId,
    spaceId: _spaceId,
  } = input;
  const response = await api.get<unknown>(`/intake-items/${intakeItemId}`);

  return GetIntakeItemResponseSchema.parse(response.data);
}

export async function updateIntakeItem(
  context: IntakeItemIdentityInput,
  input: UpdateIntakeItemInput,
  api: IntakeApiTransport = defaultApi,
): Promise<IntakeItem> {
  const {
    intakeItemId,
    organizationId: _organizationId,
    spaceId: _spaceId,
  } = context;
  const body = UpdateIntakeItemRequestSchema.parse(input);
  const response = await api.patch<unknown>(
    `/intake-items/${intakeItemId}`,
    body,
  );

  return UpdateIntakeItemResponseSchema.parse(response.data);
}

export async function acceptIntakeItem(
  context: IntakeItemIdentityInput,
  api: IntakeApiTransport = defaultApi,
): Promise<IntakeItem> {
  return postIntakeStatusAction(
    context,
    "accept",
    AcceptIntakeItemResponseSchema,
    api,
  );
}

export async function deferIntakeItem(
  context: IntakeItemIdentityInput,
  api: IntakeApiTransport = defaultApi,
): Promise<IntakeItem> {
  return postIntakeStatusAction(
    context,
    "defer",
    DeferIntakeItemResponseSchema,
    api,
  );
}

export async function rejectIntakeItem(
  context: IntakeItemIdentityInput,
  api: IntakeApiTransport = defaultApi,
): Promise<IntakeItem> {
  return postIntakeStatusAction(
    context,
    "reject",
    RejectIntakeItemResponseSchema,
    api,
  );
}

export async function convertIntakeItemToWorkItems(
  context: IntakeItemIdentityInput,
  input: ConvertIntakeItemInput,
  api: IntakeApiTransport = defaultApi,
): Promise<ConvertIntakeItemToWorkItemsResponse> {
  const {
    intakeItemId,
    organizationId: _organizationId,
    spaceId: _spaceId,
  } = context;
  const body = ConvertIntakeItemToWorkItemsRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/intake-items/${intakeItemId}/convert-to-work-items`,
    body,
  );

  return ConvertIntakeItemToWorkItemsResponseSchema.parse(response.data);
}

async function postIntakeStatusAction<TSchema extends z.ZodType<IntakeItem>>(
  context: IntakeItemIdentityInput,
  action: "accept" | "defer" | "reject",
  schema: TSchema,
  api: IntakeApiTransport,
): Promise<IntakeItem> {
  const {
    intakeItemId,
    organizationId: _organizationId,
    spaceId: _spaceId,
  } = context;
  const response = await api.post<unknown>(
    `/intake-items/${intakeItemId}/${action}`,
    {},
  );

  return schema.parse(response.data);
}
