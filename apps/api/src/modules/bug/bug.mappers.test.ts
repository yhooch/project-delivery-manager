import { describe, expect, it } from "vitest";

import { toBugView, type PrismaBugViewRecord } from "./bug.mappers";

describe("bug mappers", () => {
  it("maps bug views with BUG display code", () => {
    expect(
      toBugView({
        ...workItem(),
        sequence: 13,
        type: "BUG",
        bugDetail: {
          actualResult: null,
          expectedResult: null,
          fixNote: null,
          regressionAt: null,
          regressionById: null,
          regressionResult: null,
          relatedTaskId: null,
          severity: "MAJOR",
          stepsToReproduce: null,
          workItemId: "01H00000000000000000000002",
        },
      }),
    ).toMatchObject({
      sequence: 13,
      displayCode: "BUG-13",
      type: "BUG",
    });
  });
});

function workItem(): Omit<PrismaBugViewRecord, "bugDetail"> {
  return {
    assigneeId: null,
    blockedAt: null,
    blockedReason: null,
    createdAt: new Date("2026-05-13T12:00:00.000Z"),
    createdById: null,
    currentStateId: "01H00000000000000000000001",
    description: null,
    dueDate: null,
    id: "01H00000000000000000000002",
    intakeItemId: null,
    lastActionAt: null,
    lastStatusChangedAt: new Date("2026-05-13T12:30:00.000Z"),
    organizationId: "01H00000000000000000000003",
    priority: "HIGH",
    reporterId: "01H00000000000000000000004",
    requirementId: null,
    sequence: 13,
    spaceId: "01H00000000000000000000005",
    statusCategory: "VERIFYING",
    title: "Fix readable code",
    type: "BUG",
    versionId: null,
    workflowVersionId: "01H00000000000000000000006",
  };
}
