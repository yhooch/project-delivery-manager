import { describe, expect, it } from "vitest";

import { canCreateSpaceInOrganization } from "./permission-gates";

describe("permission gates", () => {
  it.each(["OWNER", "ADMIN"])(
    "allows active %s organizations to create spaces",
    (role) => {
      expect(canCreateSpaceInOrganization(role, "ACTIVE")).toBe(true);
    },
  );

  it.each([
    ["MEMBER", "ACTIVE"],
    ["OWNER", "DISABLED"],
    ["ADMIN", undefined],
    [undefined, "ACTIVE"],
  ])("blocks create-space for role=%s status=%s", (role, status) => {
    expect(canCreateSpaceInOrganization(role, status)).toBe(false);
  });
});
