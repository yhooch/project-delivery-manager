import { describe, expect, it } from "vitest";

import { toRequirementRelatedWorkItems } from "./requirement.mappers";

describe("requirement mappers", () => {
  it("groups related work items into task and bug summaries", () => {
    const related = toRequirementRelatedWorkItems([
      {
        id: "01H00000000000000000000001",
        type: "TASK",
        title: "Implement task",
        versionId: "01H00000000000000000000002",
        assigneeId: "01H00000000000000000000003",
        statusCategory: "IN_PROGRESS",
      },
      {
        id: "01H00000000000000000000004",
        type: "BUG",
        title: "Fix regression",
        versionId: null,
        assigneeId: null,
        statusCategory: "VERIFYING",
      },
    ]);

    expect(related).toEqual({
      taskCount: 1,
      bugCount: 1,
      tasks: [
        {
          id: "01H00000000000000000000001",
          type: "TASK",
          title: "Implement task",
          versionId: "01H00000000000000000000002",
          assigneeId: "01H00000000000000000000003",
          statusCategory: "IN_PROGRESS",
        },
      ],
      bugs: [
        {
          id: "01H00000000000000000000004",
          type: "BUG",
          title: "Fix regression",
          statusCategory: "VERIFYING",
        },
      ],
    });
  });
});
