import { describe, expect, it } from "vitest";

import {
  convertIntakeItemFormSchema,
  createIntakeItemFormSchema,
  intakeStatusActionFormSchema,
  toConvertIntakeItemRequest,
  toCreateIntakeItemRequest,
  toUpdateIntakeItemRequest,
  updateIntakeItemFormSchema,
} from "./intake-forms";

const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FB3";

describe("intake forms", () => {
  it("normalizes create intake values through the shared request schema", () => {
    const result = createIntakeItemFormSchema.safeParse({
      assigneeId: "",
      description: "  Follow up from planning  ",
      priority: "",
      requirementId,
      sourceObject: '{ "meetingId": "m-1" }',
      sourceType: "MEETING_DECISION",
      title: "  Checkout scope follow-up  ",
      versionId,
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data : null).toMatchObject({
      description: "Follow up from planning",
      requirementId,
      sourceObject: {
        meetingId: "m-1",
      },
      sourceType: "MEETING_DECISION",
      title: "Checkout scope follow-up",
      versionId,
    });
    expect(result.success ? result.data.assigneeId : null).toBeUndefined();
    expect(result.success ? result.data.priority : null).toBeUndefined();

    expect(
      toCreateIntakeItemRequest({
        sourceType: "AD_HOC",
        title: "Quick follow-up",
      }),
    ).toEqual({
      sourceType: "AD_HOC",
      title: "Quick follow-up",
    });
  });

  it("normalizes update intake values and status actions", () => {
    expect(
      toUpdateIntakeItemRequest({
        assigneeId: "",
        description: "",
        priority: "HIGH",
        title: "  Updated intake  ",
      }),
    ).toEqual({
      priority: "HIGH",
      title: "Updated intake",
    });

    expect(
      updateIntakeItemFormSchema.safeParse({
        sourceObject: "{invalid",
      }).success,
    ).toBe(false);
    expect(
      intakeStatusActionFormSchema.safeParse({
        action: "accept",
      }).success,
    ).toBe(true);
    expect(
      intakeStatusActionFormSchema.safeParse({
        action: "convert",
      }).success,
    ).toBe(false);
  });

  it("validates convert task breakdown through the shared convert schema", () => {
    expect(
      convertIntakeItemFormSchema.safeParse({
        tasks: [],
      }).success,
    ).toBe(false);

    expect(
      toConvertIntakeItemRequest({
        tasks: [
          {
            assigneeId,
            description: "",
            dueDate: "",
            priority: "",
            requirementId: "",
            title: "  Implement checkout scope  ",
            versionId,
            workflowVersionId,
          },
        ],
      }),
    ).toEqual({
      tasks: [
        {
          assigneeId,
          title: "Implement checkout scope",
          versionId,
          workflowVersionId,
        },
      ],
    });
  });
});
