import { describe, expect, it } from "vitest";

import { toIntakeItem } from "./intake.mappers";

describe("intake mappers", () => {
  it("maps intake display identity from sequence", () => {
    const item = toIntakeItem({
      acceptedAt: null,
      assigneeId: null,
      convertedAt: null,
      createdAt: new Date("2026-05-13T12:00:00.000Z"),
      description: null,
      id: "01H00000000000000000000001",
      organizationId: "01H00000000000000000000002",
      priority: null,
      reporterId: "01H00000000000000000000003",
      requirementId: null,
      sequence: 4,
      sourceObject: null,
      sourceType: "AD_HOC",
      spaceId: "01H00000000000000000000004",
      status: "PENDING",
      title: "Customer request",
      updatedAt: new Date("2026-05-13T12:30:00.000Z"),
      versionId: null,
    });

    expect(item).toMatchObject({
      sequence: 4,
      displayCode: "INTAKE-4",
    });
  });
});
