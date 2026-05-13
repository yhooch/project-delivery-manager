import { describe, expect, it } from "vitest";

import {
  addOrganizationMemberFormSchema,
  addSpaceMemberFormSchema,
  createSpaceFormSchema,
  toAddOrganizationMemberRequest,
  toAddSpaceMemberRequest,
} from "./space-forms";

describe("space forms", () => {
  it("normalizes optional create space fields through the shared schema", () => {
    const result = createSpaceFormSchema.safeParse({
      code: "",
      description: "",
      name: "Core",
      ownerId: "",
      staleThresholdDays: "3",
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data : null).toMatchObject({
      name: "Core",
      staleThresholdDays: 3,
    });
    expect(result.success ? result.data.code : null).toBeUndefined();
    expect(result.success ? result.data.ownerId : null).toBeUndefined();
  });

  it("requires a user identifier when adding organization members", () => {
    expect(
      addOrganizationMemberFormSchema.safeParse({
        role: "MEMBER",
        username: "",
      }).success,
    ).toBe(false);

    expect(
      toAddOrganizationMemberRequest({
        role: "MEMBER",
        username: "demo",
      }),
    ).toEqual({
      role: "MEMBER",
      username: "demo",
    });
  });

  it("normalizes selected organization members for space membership", () => {
    expect(
      addSpaceMemberFormSchema.safeParse({
        role: "VIEWER",
        userId: "",
      }).success,
    ).toBe(false);

    expect(
      toAddSpaceMemberRequest({
        role: "VIEWER",
        userId: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
      }),
    ).toEqual({
      role: "VIEWER",
      userId: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
    });
  });
});
