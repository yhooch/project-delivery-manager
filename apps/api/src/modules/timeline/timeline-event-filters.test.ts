import { describe, expect, it } from "vitest";

import { excludeRedundantWorkflowActionEvents } from "./timeline-event-filters";

describe("timeline event filters", () => {
  it("excludes legacy workflow side-effect events that duplicate action execution", () => {
    const where = excludeRedundantWorkflowActionEvents({
      deletedAt: null,
      organizationId: "01H00000000000000000000000",
    });

    expect(where).toMatchObject({
      AND: [
        {
          NOT: {
            OR: [
              {
                eventType: "ASSIGNEE_CHANGED",
              },
              {
                eventType: {
                  in: ["CLOSED", "REOPENED"],
                },
                metadata: {
                  path: ["actionId"],
                  string_starts_with: "",
                },
              },
            ],
          },
        },
      ],
      deletedAt: null,
      organizationId: "01H00000000000000000000000",
    });
  });

  it("preserves existing AND clauses", () => {
    const where = excludeRedundantWorkflowActionEvents({
      AND: [{ targetType: "WORK_ITEM" }],
      deletedAt: null,
    });

    expect(where.AND).toEqual([
      { targetType: "WORK_ITEM" },
      {
        NOT: {
          OR: [
            {
              eventType: "ASSIGNEE_CHANGED",
            },
            {
              eventType: {
                in: ["CLOSED", "REOPENED"],
              },
              metadata: {
                path: ["actionId"],
                string_starts_with: "",
              },
            },
          ],
        },
      },
    ]);
  });
});
