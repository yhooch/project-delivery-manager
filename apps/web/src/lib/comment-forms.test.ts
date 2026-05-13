import { describe, expect, it } from "vitest";

import { createCommentFormSchema, toCreateCommentRequest } from "./comment-forms";

const targetId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";

describe("comment forms", () => {
  it("trims comment body and validates target with the shared request schema", () => {
    expect(
      toCreateCommentRequest({
        body: "  Looks good.  ",
        targetId,
        targetType: "WORK_ITEM",
      }),
    ).toEqual({
      body: "Looks good.",
      targetId,
      targetType: "WORK_ITEM",
    });

    expect(
      createCommentFormSchema.safeParse({
        body: "   ",
        targetId,
        targetType: "WORK_ITEM",
      }).success,
    ).toBe(false);
  });
});
