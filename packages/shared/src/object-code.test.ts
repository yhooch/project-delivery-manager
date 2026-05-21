import { describe, expect, it } from "vitest";

import { ObjectCodeLookupResultSchema } from "./object-code.ts";

const BASE_RESULT = {
  id: "01TRZ3NDEKTSV4RRFFQ69G5FAT",
  type: "WORK_ITEM",
  organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
  spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
  sequence: 12,
  displayCode: "TASK-12",
  title: "Implement dashboard",
};

describe("object code contracts", () => {
  it("accepts TASK lookup results with title and workItemType", () => {
    expect(
      ObjectCodeLookupResultSchema.parse({
        ...BASE_RESULT,
        workItemType: "TASK",
      }),
    ).toEqual({
      ...BASE_RESULT,
      workItemType: "TASK",
    });
  });

  it("accepts BUG lookup results with title and workItemType", () => {
    expect(
      ObjectCodeLookupResultSchema.parse({
        ...BASE_RESULT,
        id: "01VRZ3NDEKTSV4RRFFQ69G5FAV",
        sequence: 7,
        displayCode: "BUG-7",
        title: "Fix login regression",
        workItemType: "BUG",
      }),
    ).toMatchObject({
      type: "WORK_ITEM",
      workItemType: "BUG",
      title: "Fix login regression",
    });
  });

  it("does not expose internal objectType in lookup results", () => {
    expect(() =>
      ObjectCodeLookupResultSchema.parse({
        ...BASE_RESULT,
        workItemType: "TASK",
        objectType: "TASK",
      }),
    ).toThrow();
  });
});
