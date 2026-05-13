import type {
  ActionFormFieldSummary,
  PageResult,
  WorkflowActionSummary,
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowState,
  WorkflowVersion,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createActionFormField,
  createWorkflow,
  createWorkflowAction,
  createWorkflowBinding,
  createWorkflowState,
  createWorkflowVersion,
  deleteActionFormField,
  deleteWorkflowAction,
  deleteWorkflowState,
  getWorkflow,
  getWorkflowVersion,
  listWorkflowBindings,
  listWorkflows,
  publishWorkflowVersion,
  updateActionFormField,
  updateWorkflow,
  updateWorkflowAction,
  updateWorkflowBinding,
  updateWorkflowState,
  updateWorkflowVersion,
  type WorkflowApiTransport,
} from "./workflow-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const workflowId = "01ARZ3NDEKTSV4RRFFQ69G5FC0";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FC1";
const sourceWorkflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FC2";
const fromStateId = "01ARZ3NDEKTSV4RRFFQ69G5FC3";
const toStateId = "01ARZ3NDEKTSV4RRFFQ69G5FC4";
const actionId = "01ARZ3NDEKTSV4RRFFQ69G5FC5";
const fieldId = "01ARZ3NDEKTSV4RRFFQ69G5FC6";
const bindingId = "01ARZ3NDEKTSV4RRFFQ69G5FC7";

function createWorkflowFixture(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    code: "BUG_FLOW",
    description: "Bug lifecycle",
    id: workflowId,
    name: "Bug flow",
    organizationId,
    spaceId,
    status: "ACTIVE",
    ...overrides,
  };
}

function createStateFixture(
  overrides: Partial<WorkflowState> = {},
): WorkflowState {
  return {
    category: "NOT_STARTED",
    code: "OPEN",
    id: fromStateId,
    isEnd: false,
    isStart: true,
    name: "Open",
    order: 0,
    workflowVersionId,
    ...overrides,
  };
}

function createFieldFixture(
  overrides: Partial<ActionFormFieldSummary> = {},
): ActionFormFieldSummary {
  return {
    fieldType: "TEXTAREA",
    id: fieldId,
    key: "blockedReason",
    label: "Blocked reason",
    order: 0,
    required: true,
    ...overrides,
  };
}

function createActionFixture(
  overrides: Partial<WorkflowActionSummary> = {},
): WorkflowActionSummary {
  return {
    actorRelations: ["ASSIGNEE"],
    allowedSpaceRoles: ["DEVELOPER"],
    code: "MARK_BLOCKED",
    formFields: [createFieldFixture()],
    fromStateId,
    id: actionId,
    name: "Mark blocked",
    order: 0,
    requiresComment: true,
    toStateId,
    ...overrides,
  };
}

function createVersionFixture(
  overrides: Partial<WorkflowVersion> = {},
): WorkflowVersion {
  return {
    actions: [createActionFixture()],
    id: workflowVersionId,
    states: [
      createStateFixture(),
      createStateFixture({
        category: "WAITING",
        code: "BLOCKED",
        id: toStateId,
        isStart: false,
        name: "Blocked",
        order: 1,
      }),
    ],
    status: "DRAFT",
    version: 2,
    workflowId,
    ...overrides,
  };
}

function createBindingFixture(
  overrides: Partial<WorkflowBinding> = {},
): WorkflowBinding {
  return {
    id: bindingId,
    isDefault: true,
    organizationId,
    priority: "HIGH",
    spaceId,
    workflowId,
    workflowVersionId,
    workItemType: "BUG",
    ...overrides,
  };
}

function createPage<T>(items: T[]): PageResult<T> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function createApi(
  overrides: Partial<Record<keyof WorkflowApiTransport, unknown>>,
): WorkflowApiTransport {
  return {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as WorkflowApiTransport;
}

describe("workflow service", () => {
  it("lists, creates, reads, and updates workflow definitions", async () => {
    const workflow = createWorkflowFixture();
    const page = createPage([workflow]);
    const api = createApi({
      get: vi.fn(async (path: string) => ({
        data: path.includes("/spaces/") ? page : workflow,
      })),
      patch: vi.fn(async () => ({
        data: createWorkflowFixture({ name: "Updated bug flow" }),
      })),
      post: vi.fn(async () => ({ data: workflow })),
    });

    await expect(
      listWorkflows({ organizationId, page: 1, pageSize: 20, spaceId }, api),
    ).resolves.toEqual(page);
    await expect(
      createWorkflow(
        { organizationId, spaceId },
        {
          code: "BUG_FLOW",
          description: "Bug lifecycle",
          name: "Bug flow",
        },
        api,
      ),
    ).resolves.toEqual(workflow);
    await expect(
      getWorkflow({ organizationId, spaceId, workflowId }, api),
    ).resolves.toEqual(workflow);
    await expect(
      updateWorkflow(
        { organizationId, spaceId, workflowId },
        {
          name: "Updated bug flow",
        },
        api,
      ),
    ).resolves.toMatchObject({ name: "Updated bug flow" });

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/workflows`, {
      query: {
        page: 1,
        pageSize: 20,
      },
    });
    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/workflows`, {
      code: "BUG_FLOW",
      description: "Bug lifecycle",
      name: "Bug flow",
    });
    expect(api.get).toHaveBeenCalledWith(`/workflows/${workflowId}`);
    expect(api.patch).toHaveBeenCalledWith(`/workflows/${workflowId}`, {
      name: "Updated bug flow",
    });
  });

  it("manages workflow versions and publishes through shared schemas", async () => {
    const version = createVersionFixture();
    const published = createVersionFixture({
      publishedAt: "2026-05-13T10:00:00.000Z",
      status: "PUBLISHED",
    });
    const api = createApi({
      get: vi.fn(async () => ({ data: version })),
      patch: vi.fn(async () => ({ data: createVersionFixture({ status: "DISABLED" }) })),
      post: vi.fn(async (path: string) => ({
        data: path.endsWith("/publish") ? published : version,
      })),
    });

    await expect(
      createWorkflowVersion(
        { organizationId, spaceId, workflowId },
        { sourceWorkflowVersionId },
        api,
      ),
    ).resolves.toEqual(version);
    await expect(
      getWorkflowVersion({ organizationId, spaceId, workflowVersionId }, api),
    ).resolves.toEqual(version);
    await expect(
      updateWorkflowVersion(
        { organizationId, spaceId, workflowVersionId },
        { status: "DISABLED" },
        api,
      ),
    ).resolves.toMatchObject({ status: "DISABLED" });
    await expect(
      publishWorkflowVersion({ organizationId, spaceId, workflowVersionId }, api),
    ).resolves.toEqual(published);

    expect(api.post).toHaveBeenCalledWith(`/workflows/${workflowId}/versions`, {
      sourceWorkflowVersionId,
    });
    expect(api.get).toHaveBeenCalledWith(
      `/workflow-versions/${workflowVersionId}`,
    );
    expect(api.patch).toHaveBeenCalledWith(
      `/workflow-versions/${workflowVersionId}`,
      { status: "DISABLED" },
    );
    expect(api.post).toHaveBeenCalledWith(
      `/workflow-versions/${workflowVersionId}/publish`,
      {},
    );
  });

  it("manages states, actions, form fields, and bindings", async () => {
    const state = createStateFixture();
    const action = createActionFixture();
    const field = createFieldFixture();
    const binding = createBindingFixture();
    const bindingPage = createPage([binding]);
    const api = createApi({
      delete: vi.fn(async () => ({ data: {} })),
      get: vi.fn(async () => ({ data: bindingPage })),
      patch: vi.fn(async (path: string) => {
        if (path.includes("workflow-states")) {
          return { data: createStateFixture({ name: "Open updated" }) };
        }
        if (path.includes("workflow-actions")) {
          return { data: createActionFixture({ requiresComment: false }) };
        }
        if (path.includes("action-form-fields")) {
          return { data: createFieldFixture({ required: false }) };
        }
        return { data: createBindingFixture({ isDefault: false }) };
      }),
      post: vi.fn(async (path: string) => {
        if (path.includes("/states")) {
          return { data: state };
        }
        if (path.includes("/actions")) {
          return { data: action };
        }
        if (path.includes("/form-fields")) {
          return { data: field };
        }
        return { data: binding };
      }),
    });

    await expect(
      createWorkflowState(
        { organizationId, spaceId, workflowVersionId },
        {
          category: "NOT_STARTED",
          code: "OPEN",
          isStart: true,
          name: "Open",
          order: 0,
        },
        api,
      ),
    ).resolves.toEqual(state);
    await expect(
      updateWorkflowState(
        { organizationId, spaceId, stateId: fromStateId },
        { name: "Open updated" },
        api,
      ),
    ).resolves.toMatchObject({ name: "Open updated" });
    await expect(
      deleteWorkflowState({ organizationId, spaceId, stateId: fromStateId }, api),
    ).resolves.toEqual({});

    await expect(
      createWorkflowAction(
        { organizationId, spaceId, workflowVersionId },
        {
          actorRelations: ["ASSIGNEE"],
          allowedSpaceRoles: ["DEVELOPER"],
          code: "MARK_BLOCKED",
          fromStateId,
          name: "Mark blocked",
          requiresComment: true,
          toStateId,
        },
        api,
      ),
    ).resolves.toEqual(action);
    await expect(
      updateWorkflowAction(
        { actionId, organizationId, spaceId },
        { requiresComment: false },
        api,
      ),
    ).resolves.toMatchObject({ requiresComment: false });
    await expect(
      deleteWorkflowAction({ actionId, organizationId, spaceId }, api),
    ).resolves.toEqual({});

    await expect(
      createActionFormField(
        { actionId, organizationId, spaceId },
        {
          fieldType: "TEXTAREA",
          key: "blockedReason",
          label: "Blocked reason",
          required: true,
        },
        api,
      ),
    ).resolves.toEqual(field);
    await expect(
      updateActionFormField(
        { fieldId, organizationId, spaceId },
        { required: false },
        api,
      ),
    ).resolves.toMatchObject({ required: false });
    await expect(
      deleteActionFormField({ fieldId, organizationId, spaceId }, api),
    ).resolves.toEqual({});

    await expect(
      listWorkflowBindings(
        {
          isDefault: true,
          organizationId,
          page: 1,
          pageSize: 20,
          priority: "HIGH",
          spaceId,
          workItemType: "BUG",
        },
        api,
      ),
    ).resolves.toEqual(bindingPage);
    await expect(
      createWorkflowBinding(
        { organizationId, spaceId },
        {
          isDefault: true,
          priority: "HIGH",
          workflowId,
          workflowVersionId,
          workItemType: "BUG",
        },
        api,
      ),
    ).resolves.toEqual(binding);
    await expect(
      updateWorkflowBinding(
        { bindingId, organizationId, spaceId },
        { isDefault: false },
        api,
      ),
    ).resolves.toMatchObject({ isDefault: false });

    expect(api.post).toHaveBeenCalledWith(
      `/workflow-versions/${workflowVersionId}/states`,
      {
        category: "NOT_STARTED",
        code: "OPEN",
        isStart: true,
        name: "Open",
        order: 0,
      },
    );
    expect(api.patch).toHaveBeenCalledWith(`/workflow-states/${fromStateId}`, {
      name: "Open updated",
    });
    expect(api.delete).toHaveBeenCalledWith(`/workflow-states/${fromStateId}`);
    expect(api.post).toHaveBeenCalledWith(
      `/workflow-versions/${workflowVersionId}/actions`,
      {
        actorRelations: ["ASSIGNEE"],
        allowedSpaceRoles: ["DEVELOPER"],
        code: "MARK_BLOCKED",
        fromStateId,
        name: "Mark blocked",
        requiresComment: true,
        toStateId,
      },
    );
    expect(api.patch).toHaveBeenCalledWith(`/workflow-actions/${actionId}`, {
      requiresComment: false,
    });
    expect(api.delete).toHaveBeenCalledWith(`/workflow-actions/${actionId}`);
    expect(api.post).toHaveBeenCalledWith(
      `/workflow-actions/${actionId}/form-fields`,
      {
        fieldType: "TEXTAREA",
        key: "blockedReason",
        label: "Blocked reason",
        required: true,
      },
    );
    expect(api.patch).toHaveBeenCalledWith(`/action-form-fields/${fieldId}`, {
      required: false,
    });
    expect(api.delete).toHaveBeenCalledWith(`/action-form-fields/${fieldId}`);
    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/workflow-bindings`, {
      query: {
        isDefault: true,
        page: 1,
        pageSize: 20,
        priority: "HIGH",
        workItemType: "BUG",
      },
    });
    expect(api.post).toHaveBeenCalledWith(
      `/spaces/${spaceId}/workflow-bindings`,
      {
        isDefault: true,
        priority: "HIGH",
        workflowId,
        workflowVersionId,
        workItemType: "BUG",
      },
    );
    expect(api.patch).toHaveBeenCalledWith(`/workflow-bindings/${bindingId}`, {
      isDefault: false,
    });
  });

  it("rejects workflow version responses with invalid nested actions", async () => {
    const api = createApi({
      get: vi.fn(async () => ({
        data: createVersionFixture({
          actions: [
            {
              ...createActionFixture(),
              formFields: [
                {
                  ...createFieldFixture(),
                  fieldType: "UNKNOWN",
                },
              ],
            } as unknown as WorkflowActionSummary,
          ],
        }),
      })),
    });

    await expect(
      getWorkflowVersion({ organizationId, spaceId, workflowVersionId }, api),
    ).rejects.toThrow();
  });
});
