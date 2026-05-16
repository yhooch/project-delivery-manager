import { describe, expect, it } from "vitest";

import {
  addOrganizationMemberFormSchema,
  addSpaceMemberFormSchema,
  createSpaceFormSchema,
  toAddOrganizationMemberRequest,
  toAddSpaceMemberRequest,
  toCreateSpaceRequest,
  toUpdateSpaceRequest,
} from "./space-forms";

describe("space forms", () => {
  it("normalizes optional create space fields through the shared schema", () => {
    const request = toCreateSpaceRequest({
      code: "",
      description: "",
      name: "  Core  ",
      ownerId: "",
      staleThresholdDays: "3",
    });

    expect(request).toEqual({
      name: "Core",
      staleThresholdDays: 3,
    });

    expect(
      createSpaceFormSchema.safeParse({
        code: "",
        description: "",
        name: "   ",
      }).success,
    ).toBe(false);
  });

  it("normalizes update space fields while preserving explicit clear values", () => {
    expect(
      toUpdateSpaceRequest({
        code: "  CORE  ",
        description: "   ",
        name: "  Core space  ",
        ownerId: "",
        staleThresholdDays: "7",
      }),
    ).toEqual({
      code: "CORE",
      description: null,
      name: "Core space",
      ownerId: null,
      staleThresholdDays: 7,
    });
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
