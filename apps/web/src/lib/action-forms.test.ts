import type {
  ActionFormFieldSummary,
  WorkflowActionSummary,
} from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import {
  createActionExecutionFormSchema,
  toExecuteActionRequest,
} from "./action-forms";

const actionId = "01ARZ3NDEKTSV4RRFFQ69G5FB6";
const fromStateId = "01ARZ3NDEKTSV4RRFFQ69G5FB4";
const toStateId = "01ARZ3NDEKTSV4RRFFQ69G5FB5";
const userId = "01ARZ3NDEKTSV4RRFFQ69G5FB7";

function createField(
  overrides: Partial<ActionFormFieldSummary>,
): ActionFormFieldSummary {
  return {
    fieldType: "TEXT",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FBC",
    key: "field",
    label: "Field",
    order: 0,
    required: false,
    ...overrides,
  };
}

function createAction(
  fields: ActionFormFieldSummary[],
  requiresComment = false,
): WorkflowActionSummary {
  return {
    code: "SUBMIT",
    formFields: fields,
    fromStateId,
    id: actionId,
    name: "Submit",
    order: 0,
    requiresComment,
    toStateId,
  };
}

describe("action forms", () => {
  it("builds execute payloads for comment, text, select, user, date, and number fields", () => {
    const config = createAction(
      [
        createField({
          fieldType: "TEXT",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBD",
          key: "summary",
          required: true,
        }),
        createField({
          fieldType: "TEXTAREA",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBE",
          key: "note",
        }),
        createField({
          fieldType: "SELECT",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBF",
          key: "resolution",
          options: ["FIXED", "WONT_FIX"],
          required: true,
        }),
        createField({
          fieldType: "USER",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBG",
          key: "reviewerId",
          required: true,
        }),
        createField({
          fieldType: "DATE",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBH",
          key: "reviewedAt",
          required: true,
        }),
        createField({
          fieldType: "NUMBER",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBJ",
          key: "effort",
          required: true,
        }),
      ],
      true,
    );

    expect(
      toExecuteActionRequest(config, {
        comment: "  Ready for review  ",
        formValues: {
          effort: "3.5",
          note: "",
          resolution: "FIXED",
          reviewedAt: "2026-05-13",
          reviewerId: userId,
          summary: "  Fixed null payment token  ",
        },
      }),
    ).toEqual({
      comment: "Ready for review",
      formValues: {
        effort: 3.5,
        resolution: "FIXED",
        reviewedAt: "2026-05-13T00:00:00.000Z",
        reviewerId: userId,
        summary: "Fixed null payment token",
      },
    });
  });

  it("supports flat form values and omits empty optional fields", () => {
    const config = createAction([
      createField({
        fieldType: "TEXT",
        key: "note",
      }),
      createField({
        fieldType: "NUMBER",
        id: "01ARZ3NDEKTSV4RRFFQ69G5FBJ",
        key: "effort",
      }),
    ]);

    expect(
      toExecuteActionRequest(config, {
        comment: "",
        effort: "",
        note: "  optional note  ",
      }),
    ).toEqual({
      formValues: {
        note: "optional note",
      },
    });
  });

  it("rejects missing required comment and invalid field values", () => {
    const config = createAction(
      [
        createField({
          fieldType: "SELECT",
          key: "resolution",
          options: ["FIXED"],
          required: true,
        }),
        createField({
          fieldType: "USER",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBG",
          key: "reviewerId",
        }),
        createField({
          fieldType: "DATE",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBH",
          key: "reviewedAt",
        }),
      ],
      true,
    );
    const schema = createActionExecutionFormSchema(config);

    expect(
      schema.safeParse({
        comment: "",
        formValues: {
          resolution: "FIXED",
        },
      }).success,
    ).toBe(false);

    expect(
      schema.safeParse({
        comment: "done",
        formValues: {
          resolution: "INVALID",
          reviewedAt: "not-a-date",
          reviewerId: "not-a-ulid",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects required select fields without configured options", () => {
    const config = createAction([
      createField({
        fieldType: "SELECT",
        key: "resolution",
        label: "Resolution",
        options: [],
        required: true,
      }),
    ]);

    const result = createActionExecutionFormSchema(config).safeParse({
      formValues: {
        resolution: "FIXED",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues[0]?.message).toBe(
      'Select field "Resolution" is required but has no configured options.',
    );
  });
});
