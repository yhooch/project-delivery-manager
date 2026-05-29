import { describe, expect, it } from "vitest";

import { referenceableRequirementDocumentWhere } from "./requirement-reference-policy";

describe("requirement reference policy", () => {
  it("only allows new delivery references to active numbered requirement documents", () => {
    expect(
      referenceableRequirementDocumentWhere({
        organizationId: "01H00000000000000000000001",
        requirementId: "01H00000000000000000000002",
        spaceId: "01H00000000000000000000003",
      }),
    ).toEqual({
      deletedAt: null,
      id: "01H00000000000000000000002",
      kind: "REQUIREMENT",
      organizationId: "01H00000000000000000000001",
      sequence: {
        not: null,
      },
      spaceId: "01H00000000000000000000003",
      status: "ACTIVE",
    });
  });
});
