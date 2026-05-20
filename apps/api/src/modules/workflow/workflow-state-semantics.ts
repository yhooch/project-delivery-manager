import type { StatusCategory } from "@project-delivery/shared";

export const WORKFLOW_STATE_SEMANTIC_RULES = {
  blockedTokens: ["blocked", "阻塞"] as const,
  pendingConfirmTokens: ["confirm", "待确认", "确认"] as const,
  pendingRegressionCodes: [
    "pending_regression",
    "ready_for_regression",
  ] as const,
  pendingRegressionNames: [
    "Pending regression",
    "Ready for regression",
    "待回归",
  ] as const,
  testerVisibleTokens: ["test", "regression", "测试", "提测", "回归"] as const,
};

type WorkflowStateSemanticInput = {
  category?: StatusCategory | null;
  code?: string | null;
  isEnd?: boolean | null;
  name?: string | null;
  statusCategory?: StatusCategory | null;
};

export function isBlockedWorkflowState(input: WorkflowStateSemanticInput) {
  return (
    !isTerminalWorkflowState(input) &&
    (includesAnyToken(input.code, WORKFLOW_STATE_SEMANTIC_RULES.blockedTokens) ||
      includesAnyToken(
        input.name,
        WORKFLOW_STATE_SEMANTIC_RULES.blockedTokens,
      ))
  );
}

export function isPendingConfirmWorkflowState(
  input: WorkflowStateSemanticInput,
) {
  return (
    !isTerminalWorkflowState(input) &&
    (includesAnyToken(
      input.code,
      WORKFLOW_STATE_SEMANTIC_RULES.pendingConfirmTokens,
    ) ||
      includesAnyToken(
        input.name,
        WORKFLOW_STATE_SEMANTIC_RULES.pendingConfirmTokens,
      ))
  );
}

export function isPendingRegressionWorkflowState(
  input: WorkflowStateSemanticInput,
) {
  return (
    !isTerminalWorkflowState(input) &&
    (matchesAnyValue(
      input.code,
      WORKFLOW_STATE_SEMANTIC_RULES.pendingRegressionCodes,
    ) ||
      matchesAnyValue(
        input.name,
        WORKFLOW_STATE_SEMANTIC_RULES.pendingRegressionNames,
      ))
  );
}

export function isTesterVisibleWorkflowState(
  input: WorkflowStateSemanticInput,
) {
  return (
    isPendingConfirmWorkflowState(input) ||
    isPendingRegressionWorkflowState(input) ||
    includesAnyToken(
      input.code,
      WORKFLOW_STATE_SEMANTIC_RULES.testerVisibleTokens,
    ) ||
    includesAnyToken(
      input.name,
      WORKFLOW_STATE_SEMANTIC_RULES.testerVisibleTokens,
    )
  );
}

export function isTerminalStatusCategory(
  statusCategory: StatusCategory | null | undefined,
) {
  return statusCategory === "DONE" || statusCategory === "TERMINATED";
}

function isTerminalWorkflowState(input: WorkflowStateSemanticInput) {
  return (
    Boolean(input.isEnd) ||
    isTerminalStatusCategory(input.statusCategory ?? input.category)
  );
}

function includesToken(value: string | null | undefined, token: string) {
  return value?.toLowerCase().includes(token.toLowerCase()) ?? false;
}

function includesAnyToken(
  value: string | null | undefined,
  tokens: readonly string[],
) {
  return tokens.some((token) => includesToken(value, token));
}

function matchesAnyValue(
  value: string | null | undefined,
  values: readonly string[],
) {
  return (
    value !== undefined &&
    value !== null &&
    values.some(
      (candidate) => value.toLowerCase() === candidate.toLowerCase(),
    )
  );
}
