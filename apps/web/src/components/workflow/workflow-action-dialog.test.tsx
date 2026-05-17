import { cleanup, render } from "@testing-library/react";
import type {
  WorkflowActionConfigSummary,
  WorkflowState,
} from "@project-delivery/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rootMessages, translatorCache } = vi.hoisted(() => ({
  rootMessages: new Map<string, string>(),
  translatorCache: new Map<string, (key: string) => string>(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string) => {
        const messageKey = namespace ? `${namespace}.${k}` : k;
        return namespace ? messageKey : (rootMessages.get(k) ?? messageKey);
      };
      translatorCache.set(key, fn);
    }
    return fn;
  },
}));

const { createWorkflowActionMock, updateWorkflowActionMock } = vi.hoisted(
  () => ({
    createWorkflowActionMock: vi.fn(),
    updateWorkflowActionMock: vi.fn(),
  }),
);

vi.mock("../../lib/workflow-service", () => ({
  createWorkflowAction: createWorkflowActionMock,
  updateWorkflowAction: updateWorkflowActionMock,
}));

import { WorkflowActionDialog } from "./workflow-action-dialog";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const fromStateId = "01ARZ3NDEKTSV4RRFFQ69G5ST1";
const toStateId = "01ARZ3NDEKTSV4RRFFQ69G5ST2";

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    category: "NOT_STARTED",
    code: "PENDING_CONFIRMATION",
    id: fromStateId,
    isEnd: false,
    isStart: true,
    name: "待确认",
    order: 0,
    workflowVersionId,
    ...overrides,
  };
}

function makeAction(
  overrides: Partial<WorkflowActionConfigSummary> = {},
): WorkflowActionConfigSummary {
  return {
    actorRelations: [],
    allowedSpaceRoles: [],
    code: "CONFIRM_DEFECT",
    formFields: [],
    fromStateId,
    id: "01ARZ3NDEKTSV4RRFFQ69G5AC1",
    name: "确认缺陷",
    order: 0,
    requiresComment: false,
    toStateId,
    ...overrides,
  };
}

beforeEach(() => {
  rootMessages.clear();
  createWorkflowActionMock.mockReset();
  updateWorkflowActionMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("WorkflowActionDialog", () => {
  it("localizes state options by stable workflow state code", () => {
    rootMessages.set(
      "common.workflowDefaults.states.PENDING_CONFIRMATION",
      "Pending confirmation",
    );
    rootMessages.set("common.workflowDefaults.states.PENDING_FIX", "Pending fix");

    render(
      <WorkflowActionDialog
        context={{ organizationId, spaceId }}
        mode={{ action: makeAction(), kind: "edit" }}
        onClose={() => {}}
        onSuccess={() => {}}
        open
        states={[
          makeState(),
          makeState({
            category: "WAITING",
            code: "PENDING_FIX",
            id: toStateId,
            isStart: false,
            name: "待修复",
            order: 1,
          }),
        ]}
        workflowVersionId={workflowVersionId}
      />,
    );

    const fromSelect = document.getElementById(
      "workflow-action-dialog-from",
    ) as HTMLSelectElement | null;
    const toSelect = document.getElementById(
      "workflow-action-dialog-to",
    ) as HTMLSelectElement | null;

    expect(fromSelect).not.toBeNull();
    expect(toSelect).not.toBeNull();
    const fromLabels = Array.from(
      fromSelect?.options ?? [],
      (option) => option.textContent ?? "",
    );
    const toLabels = Array.from(
      toSelect?.options ?? [],
      (option) => option.textContent ?? "",
    );

    expect(fromLabels).toEqual(["Pending confirmation", "Pending fix"]);
    expect(toLabels).toEqual(["Pending confirmation", "Pending fix"]);
    expect(fromLabels).not.toContain("待修复");
    expect(toLabels).not.toContain("待修复");
  });
});
