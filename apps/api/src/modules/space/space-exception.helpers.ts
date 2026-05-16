import type {
  StatusCategory,
  ViewExceptionSignal,
  ViewExceptionType,
} from "@project-delivery/shared";

export const SPACE_EXCEPTION_TYPES: readonly ViewExceptionType[] = [
  "overdue",
  "blocked",
  "pending_confirm",
  "pending_regression",
  "stale",
];

export const SPACE_EXCEPTION_STATE_RULES = {
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
};

export type SpaceExceptionWorkItemRecord = {
  blockedAt: Date | null;
  blockedReason: string | null;
  bugDetail?: {
    deletedAt: Date | null;
    regressionAt: Date | null;
  } | null;
  currentState: {
    code: string;
    name: string;
  };
  currentStateId: string;
  dueDate: Date | null;
  lastStatusChangedAt: Date;
  statusCategory: StatusCategory;
  type: "TASK" | "BUG";
};

export function buildSpaceExceptionSignals(
  record: SpaceExceptionWorkItemRecord,
  input: {
    now: Date;
    staleThresholdDays: number;
  },
): ViewExceptionSignal[] {
  const signals: ViewExceptionSignal[] = [];

  if (isOverdueRecord(record, input.now)) {
    signals.push({
      type: "overdue",
      evidenceSource: "DUE_DATE",
      reason: "工作项已超过截止时间",
      dueDate: record.dueDate?.toISOString(),
    });
  }

  if (isBlockedRecord(record)) {
    signals.push({
      type: "blocked",
      evidenceSource: "WORKFLOW_STATE",
      reason: record.blockedReason ?? "工作项处于阻塞状态",
      blockedAt: record.blockedAt?.toISOString(),
      blockedReason: record.blockedReason ?? undefined,
      currentStateId: record.currentStateId,
    });
  }

  if (isPendingConfirmRecord(record)) {
    signals.push({
      type: "pending_confirm",
      evidenceSource: "WORKFLOW_STATE",
      reason: "工作项处于待确认状态",
      currentStateId: record.currentStateId,
    });
  }

  if (isPendingRegressionRecord(record)) {
    signals.push({
      type: "pending_regression",
      evidenceSource: "WORKFLOW_STATE",
      reason: "Bug 处于待回归状态",
      currentStateId: record.currentStateId,
    });
  }

  const staleDays = elapsedDays(record.lastStatusChangedAt, input.now);

  if (
    staleDays >= input.staleThresholdDays &&
    !isTerminalStatusCategory(record.statusCategory)
  ) {
    signals.push({
      type: "stale",
      evidenceSource: "LAST_STATUS_CHANGED_AT",
      reason: "工作项状态长时间未变化",
      lastStatusChangedAt: record.lastStatusChangedAt.toISOString(),
      staleDays,
      staleThresholdDays: input.staleThresholdDays,
    });
  }

  return signals;
}

export function isBlockedRecord(record: SpaceExceptionWorkItemRecord) {
  return (
    !isTerminalStatusCategory(record.statusCategory) &&
    (includesAnyToken(
      record.currentState.code,
      SPACE_EXCEPTION_STATE_RULES.blockedTokens,
    ) ||
      includesAnyToken(
        record.currentState.name,
        SPACE_EXCEPTION_STATE_RULES.blockedTokens,
      ))
  );
}

export function isOverdueRecord(
  record: SpaceExceptionWorkItemRecord,
  now: Date,
) {
  return Boolean(
    record.dueDate &&
      record.dueDate.getTime() < now.getTime() &&
      !isTerminalStatusCategory(record.statusCategory),
  );
}

export function isPendingConfirmRecord(record: SpaceExceptionWorkItemRecord) {
  return (
    !isTerminalStatusCategory(record.statusCategory) &&
    !isPendingRegressionRecord(record) &&
    (includesAnyToken(
      record.currentState.code,
      SPACE_EXCEPTION_STATE_RULES.pendingConfirmTokens,
    ) ||
      includesAnyToken(
        record.currentState.name,
        SPACE_EXCEPTION_STATE_RULES.pendingConfirmTokens,
      ))
  );
}

export function isPendingRegressionRecord(record: SpaceExceptionWorkItemRecord) {
  return (
    record.type === "BUG" &&
    !isTerminalStatusCategory(record.statusCategory) &&
    Boolean(
      record.bugDetail &&
        !record.bugDetail.deletedAt &&
        !record.bugDetail.regressionAt,
    ) &&
    (record.statusCategory === "VERIFYING" ||
      matchesAnyValue(
        record.currentState.code,
        SPACE_EXCEPTION_STATE_RULES.pendingRegressionCodes,
      ) ||
      matchesAnyValue(
        record.currentState.name,
        SPACE_EXCEPTION_STATE_RULES.pendingRegressionNames,
      ))
  );
}

export function isTerminalStatusCategory(statusCategory: StatusCategory) {
  return statusCategory === "DONE" || statusCategory === "TERMINATED";
}

export function elapsedDays(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

function includesToken(value: string, token: string) {
  return value.toLowerCase().includes(token.toLowerCase());
}

function includesAnyToken(value: string, tokens: readonly string[]) {
  return tokens.some((token) => includesToken(value, token));
}

function matchesAnyValue(value: string, values: readonly string[]) {
  return values.some(
    (candidate) => value.toLowerCase() === candidate.toLowerCase(),
  );
}
