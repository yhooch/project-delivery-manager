import { describe, expect, it } from "vitest";

import { toWorkItem } from "./workitem.mappers";

describe("work item mappers", () => {
  it("maps task and bug display codes from work item type", () => {
    expect(toWorkItem(workItem({ sequence: 21, type: "TASK" }))).toMatchObject({
      sequence: 21,
      displayCode: "TASK-21",
    });
    expect(toWorkItem(workItem({ sequence: 8, type: "BUG" }))).toMatchObject({
      sequence: 8,
      displayCode: "BUG-8",
    });
  });
});

function workItem(
  overrides: Partial<Parameters<typeof toWorkItem>[0]> = {},
): Parameters<typeof toWorkItem>[0] {
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
    priority: "MEDIUM",
    reporterId: "01H00000000000000000000004",
    requirementId: null,
    sequence: 1,
    spaceId: "01H00000000000000000000005",
    statusCategory: "IN_PROGRESS",
    title: "Implement readable codes",
    type: "TASK",
    versionId: null,
    workflowVersionId: "01H00000000000000000000006",
    ...overrides,
  };
}
