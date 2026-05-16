import { describe, expect, it } from "vitest";

import { GetAuthSessionQuerySchema } from "./auth.ts";

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
});
