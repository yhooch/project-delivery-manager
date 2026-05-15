import { describe, expect, it } from "vitest";

import {
  createTaskFormSchema,
  toCreateTaskRequest,
  toUpdateTaskRequest,
} from "./work-item-forms";

const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";

describe("work item forms", () => {
  it("normalizes create task values and defaults to TASK-only MEDIUM priority", () => {
    expect(
      toCreateTaskRequest({
        assigneeId: "",
        description: "",
        dueDate: "",
        intakeItemId,
        priority: "",
        requirementId,
        title: "  Implement checkout scope  ",
        type: "",
        versionId,
        workflowVersionId: "",
      }),
    ).toEqual({
      intakeItemId,
      priority: "MEDIUM",
      requirementId,
      title: "Implement checkout scope",
      type: "TASK",
      versionId,
    });
  });

  it("rejects non-task create requests in the form model", () => {
    expect(
      createTaskFormSchema.safeParse({
        priority: "HIGH",
        title: "Bug-like work item",
        type: "BUG",
      }).success,
    ).toBe(false);
  });

  it("normalizes update task values through the shared update schema", () => {
    expect(
      toUpdateTaskRequest({
        assigneeId,
        blockedReason: "",
        description: "  Ready for implementation  ",
        dueDate: "",
        priority: "URGENT",
        requirementId: "",
        title: "",
        versionId: "",
      }),
    ).toEqual({
      assigneeId,
      description: "Ready for implementation",
      dueDate: null,
      priority: "URGENT",
      requirementId: null,
      versionId: null,
    });
  });
});
