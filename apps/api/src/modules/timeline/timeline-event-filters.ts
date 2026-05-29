import { Prisma } from "../../generated/prisma/client";

const REDUNDANT_WORKFLOW_ACTION_EVENT_TYPES = [
  "CLOSED",
  "REOPENED",
] as const;

export function excludeRedundantWorkflowActionEvents(
  where: Prisma.TimelineEventWhereInput,
): Prisma.TimelineEventWhereInput {
  const clauses = Array.isArray(where.AND)
    ? where.AND
    : where.AND
      ? [where.AND]
      : [];

  return {
    ...where,
    AND: [
      ...clauses,
      {
        NOT: {
          OR: [
            {
              eventType: "ASSIGNEE_CHANGED",
            },
            {
              eventType: {
                in: [...REDUNDANT_WORKFLOW_ACTION_EVENT_TYPES],
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
  };
}
