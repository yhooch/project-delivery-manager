import type {
  StatusCategory,
  SpaceRole,
  WorkItemType,
} from "@project-delivery/shared";

import { Prisma } from "../../generated/prisma/client";

const WORK_ITEM_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
]);

const TESTER_STATE_TOKENS = ["test", "regression", "测试", "提测", "回归"];

export function canReadAllSpaceWorkItems(role: SpaceRole) {
  return WORK_ITEM_READ_ALL_ROLES.has(role);
}

export function isTesterVisibleWorkItem(input: {
  type: WorkItemType;
  statusCategory?: StatusCategory;
  currentState?: {
    code?: string | null;
    name?: string | null;
  } | null;
}) {
  if (input.type === "BUG") {
    return true;
  }

  if (input.type !== "TASK") {
    return false;
  }

  if (input.statusCategory === "VERIFYING") {
    return true;
  }

  return isTestingOrRegressionState(input.currentState);
}

export function testerVisibleWorkItemWhere(): Prisma.WorkItemWhereInput {
  return {
    OR: [
      {
        type: "BUG",
      },
      {
        OR: [
          {
            statusCategory: "VERIFYING",
          },
          {
            currentState: {
              is: testerVisibleWorkflowStateWhere(),
            },
          },
        ],
        type: "TASK",
      },
    ],
  };
}

function testerVisibleWorkflowStateWhere(): Prisma.WorkflowStateWhereInput {
  return {
    OR: TESTER_STATE_TOKENS.flatMap((token) => [
      {
        code: {
          contains: token,
          mode: "insensitive" as const,
        },
      },
      {
        name: {
          contains: token,
          mode: "insensitive" as const,
        },
      },
    ]),
  };
}

function isTestingOrRegressionState(
  state:
    | {
        code?: string | null;
        name?: string | null;
      }
    | null
    | undefined,
) {
  const code = state?.code?.toLocaleLowerCase();
  const name = state?.name?.toLocaleLowerCase();

  return TESTER_STATE_TOKENS.some(
    (token) => code?.includes(token) || name?.includes(token),
  );
}
