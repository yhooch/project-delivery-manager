import type {
  StatusCategory,
  SpaceRole,
  WorkItemType,
} from "@project-delivery/shared";

import { Prisma } from "../../generated/prisma/client";
import {
  isTesterVisibleWorkflowState,
  WORKFLOW_STATE_SEMANTIC_RULES,
} from "../workflow/workflow-state-semantics";

const WORK_ITEM_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
]);

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

  return isTesterVisibleWorkflowState({
    category: input.statusCategory,
    code: input.currentState?.code,
    name: input.currentState?.name,
  });
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
    OR: [
      ...workflowStateTokenWhere(
        WORKFLOW_STATE_SEMANTIC_RULES.pendingConfirmTokens,
      ),
      ...workflowStateTokenWhere(
        WORKFLOW_STATE_SEMANTIC_RULES.testerVisibleTokens,
      ),
      ...workflowStateExactWhere(
        WORKFLOW_STATE_SEMANTIC_RULES.pendingRegressionCodes,
        WORKFLOW_STATE_SEMANTIC_RULES.pendingRegressionNames,
      ),
    ],
  };
}

function workflowStateTokenWhere(tokens: readonly string[]) {
  return tokens.flatMap((token) => [
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
  ]);
}

function workflowStateExactWhere(
  codes: readonly string[],
  names: readonly string[],
) {
  return [
    ...codes.map((code) => ({
      code: {
        equals: code,
        mode: "insensitive" as const,
      },
    })),
    ...names.map((name) => ({
      name: {
        equals: name,
        mode: "insensitive" as const,
      },
    })),
  ];
}
