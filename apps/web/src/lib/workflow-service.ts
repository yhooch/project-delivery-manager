import {
  CreateActionFormFieldRequestSchema,
  CreateActionFormFieldResponseSchema,
  CreateWorkflowActionRequestSchema,
  CreateWorkflowActionResponseSchema,
  CreateWorkflowBindingRequestSchema,
  CreateWorkflowBindingResponseSchema,
  CreateWorkflowDefinitionRequestSchema,
  CreateWorkflowDefinitionResponseSchema,
  CreateWorkflowStateRequestSchema,
  CreateWorkflowStateResponseSchema,
  CreateWorkflowVersionRequestSchema,
  CreateWorkflowVersionResponseSchema,
  DeleteActionFormFieldResponseSchema,
  DeleteWorkflowActionResponseSchema,
  DeleteWorkflowStateResponseSchema,
  GetWorkflowDefinitionResponseSchema,
  GetWorkflowVersionResponseSchema,
  ListWorkflowBindingsQuerySchema,
  ListWorkflowBindingsResponseSchema,
  ListWorkflowsQuerySchema,
  ListWorkflowsResponseSchema,
  ListWorkflowVersionsQuerySchema,
  ListWorkflowVersionsResponseSchema,
  PublishWorkflowVersionRequestSchema,
  PublishWorkflowVersionResponseSchema,
  UpdateActionFormFieldRequestSchema,
  UpdateActionFormFieldResponseSchema,
  UpdateWorkflowActionRequestSchema,
  UpdateWorkflowActionResponseSchema,
  UpdateWorkflowBindingRequestSchema,
  UpdateWorkflowBindingResponseSchema,
  UpdateWorkflowDefinitionRequestSchema,
  UpdateWorkflowDefinitionResponseSchema,
  UpdateWorkflowStateRequestSchema,
  UpdateWorkflowStateResponseSchema,
  UpdateWorkflowVersionRequestSchema,
  UpdateWorkflowVersionResponseSchema,
  type ActionFormFieldSummary,
  type PageResult,
  type WorkflowActionConfigSummary,
  type WorkflowBinding,
  type WorkflowDefinition,
  type WorkflowState,
  type WorkflowVersion,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";

export type WorkflowApiTransport = {
  delete<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
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

export type WorkflowSpaceContext = {
  organizationId?: string;
  spaceId: string;
};

export type ListWorkflowsInput = z.input<typeof ListWorkflowsQuerySchema> &
  WorkflowSpaceContext;
export type ListWorkflowVersionsInput = z.input<
  typeof ListWorkflowVersionsQuerySchema
> &
  WorkflowIdentityInput;
export type ListWorkflowBindingsInput = z.input<
  typeof ListWorkflowBindingsQuerySchema
> &
  WorkflowSpaceContext;
export type WorkflowIdentityInput = WorkflowSpaceContext & {
  workflowId: string;
};
export type WorkflowVersionIdentityInput = WorkflowSpaceContext & {
  workflowVersionId: string;
};
export type WorkflowStateIdentityInput = WorkflowSpaceContext & {
  stateId: string;
};
export type WorkflowActionIdentityInput = WorkflowSpaceContext & {
  actionId: string;
};
export type ActionFormFieldIdentityInput = WorkflowSpaceContext & {
  fieldId: string;
};
export type WorkflowBindingIdentityInput = WorkflowSpaceContext & {
  bindingId: string;
};

export type CreateWorkflowDefinitionInput = z.input<
  typeof CreateWorkflowDefinitionRequestSchema
>;
export type UpdateWorkflowDefinitionInput = z.input<
  typeof UpdateWorkflowDefinitionRequestSchema
>;
export type CreateWorkflowVersionInput = z.input<
  typeof CreateWorkflowVersionRequestSchema
>;
export type UpdateWorkflowVersionInput = z.input<
  typeof UpdateWorkflowVersionRequestSchema
>;
export type CreateWorkflowStateInput = z.input<
  typeof CreateWorkflowStateRequestSchema
>;
export type UpdateWorkflowStateInput = z.input<
  typeof UpdateWorkflowStateRequestSchema
>;
export type CreateWorkflowActionInput = z.input<
  typeof CreateWorkflowActionRequestSchema
>;
export type UpdateWorkflowActionInput = z.input<
  typeof UpdateWorkflowActionRequestSchema
>;
export type CreateActionFormFieldInput = z.input<
  typeof CreateActionFormFieldRequestSchema
>;
export type UpdateActionFormFieldInput = z.input<
  typeof UpdateActionFormFieldRequestSchema
>;
export type CreateWorkflowBindingInput = z.input<
  typeof CreateWorkflowBindingRequestSchema
>;
export type UpdateWorkflowBindingInput = z.input<
  typeof UpdateWorkflowBindingRequestSchema
>;

const defaultApi: WorkflowApiTransport = apiClient;

export async function listWorkflows(
  input: ListWorkflowsInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<PageResult<WorkflowDefinition>> {
  const { organizationId: _organizationId, spaceId, ...filters } = input;
  const query = ListWorkflowsQuerySchema.parse(filters);
  const response = await api.get<unknown>(`/spaces/${spaceId}/workflows`, {
    query,
  });

  return ListWorkflowsResponseSchema.parse(response.data);
}

export async function createWorkflow(
  context: WorkflowSpaceContext,
  input: CreateWorkflowDefinitionInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowDefinition> {
  const { organizationId: _organizationId, spaceId } = context;
  const body = CreateWorkflowDefinitionRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/spaces/${spaceId}/workflows`,
    body,
  );

  return CreateWorkflowDefinitionResponseSchema.parse(response.data);
}

export async function getWorkflow(
  input: WorkflowIdentityInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowDefinition> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowId,
  } = input;
  const response = await api.get<unknown>(`/workflows/${workflowId}`);

  return GetWorkflowDefinitionResponseSchema.parse(response.data);
}

export async function updateWorkflow(
  context: WorkflowIdentityInput,
  input: UpdateWorkflowDefinitionInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowDefinition> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowId,
  } = context;
  const body = UpdateWorkflowDefinitionRequestSchema.parse(input);
  const response = await api.patch<unknown>(`/workflows/${workflowId}`, body);

  return UpdateWorkflowDefinitionResponseSchema.parse(response.data);
}

export async function listWorkflowVersions(
  input: ListWorkflowVersionsInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<PageResult<WorkflowVersion>> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowId,
    ...filters
  } = input;
  const query = ListWorkflowVersionsQuerySchema.parse(filters);
  const response = await api.get<unknown>(
    `/workflows/${workflowId}/versions`,
    {
      query,
    },
  );

  return ListWorkflowVersionsResponseSchema.parse(response.data);
}

export async function createWorkflowVersion(
  context: WorkflowIdentityInput,
  input: CreateWorkflowVersionInput = {},
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowVersion> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowId,
  } = context;
  const body = CreateWorkflowVersionRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/workflows/${workflowId}/versions`,
    body,
  );

  return CreateWorkflowVersionResponseSchema.parse(response.data);
}

export async function getWorkflowVersion(
  input: WorkflowVersionIdentityInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowVersion> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowVersionId,
  } = input;
  const response = await api.get<unknown>(
    `/workflow-versions/${workflowVersionId}`,
  );

  return GetWorkflowVersionResponseSchema.parse(response.data);
}

export async function updateWorkflowVersion(
  context: WorkflowVersionIdentityInput,
  input: UpdateWorkflowVersionInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowVersion> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowVersionId,
  } = context;
  const body = UpdateWorkflowVersionRequestSchema.parse(input);
  const response = await api.patch<unknown>(
    `/workflow-versions/${workflowVersionId}`,
    body,
  );

  return UpdateWorkflowVersionResponseSchema.parse(response.data);
}

export async function publishWorkflowVersion(
  context: WorkflowVersionIdentityInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowVersion> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowVersionId,
  } = context;
  const body = PublishWorkflowVersionRequestSchema.parse({});
  const response = await api.post<unknown>(
    `/workflow-versions/${workflowVersionId}/publish`,
    body,
  );

  return PublishWorkflowVersionResponseSchema.parse(response.data);
}

export async function createWorkflowState(
  context: WorkflowVersionIdentityInput,
  input: CreateWorkflowStateInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowState> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowVersionId,
  } = context;
  const body = CreateWorkflowStateRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/workflow-versions/${workflowVersionId}/states`,
    body,
  );

  return CreateWorkflowStateResponseSchema.parse(response.data);
}

export async function updateWorkflowState(
  context: WorkflowStateIdentityInput,
  input: UpdateWorkflowStateInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowState> {
  const { organizationId: _organizationId, spaceId: _spaceId, stateId } = context;
  const body = UpdateWorkflowStateRequestSchema.parse(input);
  const response = await api.patch<unknown>(`/workflow-states/${stateId}`, body);

  return UpdateWorkflowStateResponseSchema.parse(response.data);
}

export async function deleteWorkflowState(
  context: WorkflowStateIdentityInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<Record<string, never>> {
  const { organizationId: _organizationId, spaceId: _spaceId, stateId } = context;
  const response = await api.delete<unknown>(`/workflow-states/${stateId}`);

  return DeleteWorkflowStateResponseSchema.parse(response.data);
}

export async function createWorkflowAction(
  context: WorkflowVersionIdentityInput,
  input: CreateWorkflowActionInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowActionConfigSummary> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    workflowVersionId,
  } = context;
  const body = CreateWorkflowActionRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/workflow-versions/${workflowVersionId}/actions`,
    body,
  );

  return CreateWorkflowActionResponseSchema.parse(response.data);
}

export async function updateWorkflowAction(
  context: WorkflowActionIdentityInput,
  input: UpdateWorkflowActionInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowActionConfigSummary> {
  const { actionId, organizationId: _organizationId, spaceId: _spaceId } = context;
  const body = UpdateWorkflowActionRequestSchema.parse(input);
  const response = await api.patch<unknown>(`/workflow-actions/${actionId}`, body);

  return UpdateWorkflowActionResponseSchema.parse(response.data);
}

export async function deleteWorkflowAction(
  context: WorkflowActionIdentityInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<Record<string, never>> {
  const { actionId, organizationId: _organizationId, spaceId: _spaceId } = context;
  const response = await api.delete<unknown>(`/workflow-actions/${actionId}`);

  return DeleteWorkflowActionResponseSchema.parse(response.data);
}

export async function createActionFormField(
  context: WorkflowActionIdentityInput,
  input: CreateActionFormFieldInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<ActionFormFieldSummary> {
  const { actionId, organizationId: _organizationId, spaceId: _spaceId } = context;
  const body = CreateActionFormFieldRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/workflow-actions/${actionId}/form-fields`,
    body,
  );

  return CreateActionFormFieldResponseSchema.parse(response.data);
}

export async function updateActionFormField(
  context: ActionFormFieldIdentityInput,
  input: UpdateActionFormFieldInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<ActionFormFieldSummary> {
  const { fieldId, organizationId: _organizationId, spaceId: _spaceId } = context;
  const body = UpdateActionFormFieldRequestSchema.parse(input);
  const response = await api.patch<unknown>(`/action-form-fields/${fieldId}`, body);

  return UpdateActionFormFieldResponseSchema.parse(response.data);
}

export async function deleteActionFormField(
  context: ActionFormFieldIdentityInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<Record<string, never>> {
  const { fieldId, organizationId: _organizationId, spaceId: _spaceId } = context;
  const response = await api.delete<unknown>(`/action-form-fields/${fieldId}`);

  return DeleteActionFormFieldResponseSchema.parse(response.data);
}

export async function listWorkflowBindings(
  input: ListWorkflowBindingsInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<PageResult<WorkflowBinding>> {
  const { organizationId: _organizationId, spaceId, ...filters } = input;
  const query = ListWorkflowBindingsQuerySchema.parse(filters);
  const response = await api.get<unknown>(
    `/spaces/${spaceId}/workflow-bindings`,
    { query },
  );

  return ListWorkflowBindingsResponseSchema.parse(response.data);
}

export async function createWorkflowBinding(
  context: WorkflowSpaceContext,
  input: CreateWorkflowBindingInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowBinding> {
  const { organizationId: _organizationId, spaceId } = context;
  const body = CreateWorkflowBindingRequestSchema.parse(input);
  const response = await api.post<unknown>(
    `/spaces/${spaceId}/workflow-bindings`,
    body,
  );

  return CreateWorkflowBindingResponseSchema.parse(response.data);
}

export async function updateWorkflowBinding(
  context: WorkflowBindingIdentityInput,
  input: UpdateWorkflowBindingInput,
  api: WorkflowApiTransport = defaultApi,
): Promise<WorkflowBinding> {
  const {
    bindingId,
    organizationId: _organizationId,
    spaceId: _spaceId,
  } = context;
  const body = UpdateWorkflowBindingRequestSchema.parse(input);
  const response = await api.patch<unknown>(
    `/workflow-bindings/${bindingId}`,
    body,
  );

  return UpdateWorkflowBindingResponseSchema.parse(response.data);
}
