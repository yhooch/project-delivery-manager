import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listWorkflowBindingsMock,
  listWorkflowVersionsMock,
  listWorkflowsMock,
} = vi.hoisted(() => ({
  listWorkflowBindingsMock: vi.fn(),
  listWorkflowVersionsMock: vi.fn(),
  listWorkflowsMock: vi.fn(),
}));

vi.mock("./workflow-service", () => ({
  listWorkflowBindings: listWorkflowBindingsMock,
  listWorkflowVersions: listWorkflowVersionsMock,
  listWorkflows: listWorkflowsMock,
}));

import type {
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowVersion,
} from "@project-delivery/shared";

import {
  formatWorkflowVersionOption,
  getDefaultWorkflowVersionId,
  loadWorkflowVersionOptions,
} from "./workflow-options";

const organizationId = "ORG_01";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const workflowId = "01ARZ3NDEKTSV4RRFFQ69G5FW1";
const disabledWorkflowId = "01ARZ3NDEKTSV4RRFFQ69G5FW2";
const bugWorkflowId = "01ARZ3NDEKTSV4RRFFQ69G5FW3";
const publishedV1Id = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const publishedV2Id = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
const publishedV3Id = "01ARZ3NDEKTSV4RRFFQ69G5FV3";
const publishedV4Id = "01ARZ3NDEKTSV4RRFFQ69G5FV4";
const draftVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV5";
const disabledVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV6";

beforeEach(() => {
  listWorkflowBindingsMock.mockReset();
  listWorkflowVersionsMock.mockReset();
  listWorkflowsMock.mockReset();
});

describe("workflow-options", () => {
  it("expands eligible bindings to all published versions for the requested work item type", async () => {
    listWorkflowsMock.mockResolvedValue({
      items: [
        makeWorkflow({ id: workflowId, name: "Task flow", status: "ACTIVE" }),
        makeWorkflow({
          id: disabledWorkflowId,
          name: "Disabled flow",
          status: "DISABLED",
        }),
        makeWorkflow({
          id: bugWorkflowId,
          name: "Bug flow",
          status: "ACTIVE",
        }),
      ],
      total: 3,
    });
    listWorkflowBindingsMock.mockResolvedValue({
      items: [
        makeBinding({
          id: "BIND_DEFAULT",
          isDefault: true,
          workflowId,
          workflowVersionId: publishedV2Id,
        }),
        makeBinding({
          id: "BIND_EXTRA_PRIORITY",
          workflowId,
          workflowVersionId: draftVersionId,
        }),
        makeBinding({
          id: "BIND_DISABLED_WORKFLOW",
          workflowId: disabledWorkflowId,
          workflowVersionId: publishedV1Id,
        }),
        makeBinding({
          id: "BIND_BUG",
          workflowId: bugWorkflowId,
          workflowVersionId: publishedV1Id,
          workItemType: "BUG",
        }),
      ],
      total: 4,
    });
    listWorkflowVersionsMock.mockImplementation(
      async ({ workflowId: id }: { workflowId: string }) => ({
        items:
          id === workflowId
            ? [
                makeVersion({ id: publishedV1Id, version: 1 }),
                makeVersion({ id: publishedV2Id, version: 2 }),
                makeVersion({ id: publishedV3Id, version: 3 }),
                makeVersion({ id: publishedV4Id, version: 4 }),
                makeVersion({ id: draftVersionId, status: "DRAFT" }),
                makeVersion({ id: disabledVersionId, status: "DISABLED" }),
              ]
            : [makeVersion({ id: publishedV1Id, workflowId: id, version: 1 })],
        total: 1,
      }),
    );

    const options = await loadWorkflowVersionOptions(
      { organizationId, spaceId },
      "TASK",
    );

    expect(listWorkflowBindingsMock).toHaveBeenCalledWith({
      organizationId,
      page: 1,
      pageSize: 100,
      spaceId,
      workItemType: "TASK",
    });
    expect(listWorkflowVersionsMock).toHaveBeenCalledTimes(1);
    expect(options.map((option) => option.version.id)).toEqual([
      publishedV2Id,
      publishedV4Id,
      publishedV3Id,
      publishedV1Id,
    ]);
    expect(options.map((option) => option.binding.id)).toEqual([
      "BIND_DEFAULT",
      "BIND_DEFAULT",
      "BIND_DEFAULT",
      "BIND_DEFAULT",
    ]);
    expect(getDefaultWorkflowVersionId(options)).toBe(publishedV2Id);
    expect(formatWorkflowVersionOption(options[0], (key) => key)).toBe(
      "Task flow v2 · workflow.bindingsPanel.fields.isDefault",
    );
    expect(formatWorkflowVersionOption(options[1], (key) => key)).toBe(
      "Task flow v4",
    );
    expect(options.map((option) => option.isDefault)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

function makeWorkflow(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    code: "TASK_FLOW",
    id: workflowId,
    name: "Task flow",
    organizationId,
    spaceId,
    status: "ACTIVE",
    ...overrides,
  } as WorkflowDefinition;
}

function makeVersion(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return {
    actions: [],
    id: publishedV1Id,
    states: [],
    status: "PUBLISHED",
    version: 1,
    workflowId,
    ...overrides,
  } as WorkflowVersion;
}

function makeBinding(overrides: Partial<WorkflowBinding> = {}): WorkflowBinding {
  return {
    id: "BIND_00",
    isDefault: false,
    organizationId,
    spaceId,
    workItemType: "TASK",
    workflowId,
    workflowVersionId: publishedV1Id,
    ...overrides,
  } as WorkflowBinding;
}
