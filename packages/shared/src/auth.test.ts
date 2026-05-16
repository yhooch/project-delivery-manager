import { describe, expect, it } from "vitest";

import { AppSessionSchema, GetAuthSessionQuerySchema } from "./auth.ts";

describe("auth contracts", () => {
  it("does not expose recent session selection as query contract", () => {
    expect(GetAuthSessionQuerySchema.parse({})).toEqual({});
    expect(() =>
      GetAuthSessionQuerySchema.parse({
        recentOrganizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        recentSpaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      }),
    ).toThrow();
  });

  it("requires ULID-shaped IDs in the app session contract", () => {
    expect(() =>
      AppSessionSchema.parse({
        user: {
          id: "not-a-ulid",
          username: "demo_user",
          name: "demo_user",
          status: "ACTIVE",
          preferences: {
            locale: "zh-CN",
            themeMode: "SYSTEM",
          },
        },
        organizations: [],
        spaces: [],
        capabilities: {
          canCreateOrganization: true,
          canCreateSpace: false,
        },
      }),
    ).toThrow();
  });
});
