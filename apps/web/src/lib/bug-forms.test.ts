import { describe, expect, it } from "vitest";

import {
  createBugFormSchema,
  toCreateBugRequest,
  toUpdateBugRequest,
  updateBugFormSchema,
} from "./bug-forms";

const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const regressionBy = "01ARZ3NDEKTSV4RRFFQ69G5FB5";

describe("bug forms", () => {
  it("normalizes create bug values through the shared request schema", () => {
    const result = createBugFormSchema.safeParse({
      actualResult: "  Received a 500  ",
      assigneeId: "",
      description: "  Payment service returns an intermittent 500  ",
      expectedResult: "  Checkout succeeds  ",
      priority: "",
      relatedTaskId,
      requirementId,
      severity: "",
      stepsToReproduce: "  Submit checkout form  ",
      title: "  Checkout submission fails  ",
      versionId,
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data : null).toMatchObject({
      actualResult: "Received a 500",
      description: "Payment service returns an intermittent 500",
      expectedResult: "Checkout succeeds",
      priority: "MEDIUM",
      relatedTaskId,
      requirementId,
      severity: "MAJOR",
      stepsToReproduce: "Submit checkout form",
      title: "Checkout submission fails",
      versionId,
    });
    expect(result.success ? result.data.assigneeId : null).toBeUndefined();
    expect(
      createBugFormSchema.safeParse({
        description: "",
        severity: "MAJOR",
        title: "Bug without description",
      }).success,
    ).toBe(true);

    expect(
      toCreateBugRequest({
        severity: "CRITICAL",
        description: "  Browser console shows a null token  ",
        title: "Crash on checkout",
      }),
    ).toEqual({
      description: "Browser console shows a null token",
      priority: "MEDIUM",
      severity: "CRITICAL",
      title: "Crash on checkout",
    });
  });

  it("normalizes update bug values and optional regression fields", () => {
    expect(
      toUpdateBugRequest({
        actualResult: "",
        assigneeId: "",
        dueDate: "",
        fixNote: "  Guard null payment token  ",
        priority: "HIGH",
        regressionAt: "2026-05-13T12:00:00.000Z",
        regressionBy,
        regressionResult: "  Passed  ",
        relatedTaskId: "",
        severity: "MINOR",
        title: "  Updated bug  ",
        versionId: "",
      }),
    ).toEqual({
      actualResult: null,
      assigneeId: null,
      dueDate: null,
      fixNote: "Guard null payment token",
      priority: "HIGH",
      regressionAt: "2026-05-13T12:00:00.000Z",
      regressionBy,
      regressionResult: "Passed",
      relatedTaskId: null,
      severity: "MINOR",
      title: "Updated bug",
      versionId: null,
    });

    expect(
      updateBugFormSchema.safeParse({
        relatedTaskId: "not-a-ulid",
      }).success,
    ).toBe(false);
    expect(
      updateBugFormSchema.safeParse({
        blockedReason: "Waiting for workflow action",
      }).success,
    ).toBe(false);
  });
});
