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
const PENDING_CONFIRM_STATE_TOKENS = ["confirm", "待确认", "确认"] as const;
const PENDING_REGRESSION_STATE_CODES = [
  "pending_regression",
  "ready_for_regression",
] as const;
const PENDING_REGRESSION_STATE_NAMES = [
  "Pending regression",
  "Ready for regression",
  "待回归",
] as const;
const BLOCKED_STATE_TOKENS = ["blocked", "阻塞"] as const;

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
    includesAnyToken(record.currentState.code, BLOCKED_STATE_TOKENS) ||
    includesAnyToken(record.currentState.name, BLOCKED_STATE_TOKENS)
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
    includesAnyToken(record.currentState.code, PENDING_CONFIRM_STATE_TOKENS) ||
    includesAnyToken(record.currentState.name, PENDING_CONFIRM_STATE_TOKENS)
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
    (matchesAnyValue(
      record.currentState.code,
      PENDING_REGRESSION_STATE_CODES,
    ) ||
      matchesAnyValue(record.currentState.name, PENDING_REGRESSION_STATE_NAMES))
  );
}

export function isTerminalStatusCategory(statusCategory: StatusCategory) {
  return statusCategory === "DONE" || statusCategory === "TERMINATED";
}

export function elapsedDays(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

function includesToken(value: string, token: string) {
  return value.toLowerCase().includes(token);
}

function includesAnyToken(value: string, tokens: readonly string[]) {
  return tokens.some((token) => includesToken(value, token));
}

function matchesAnyValue(value: string, values: readonly string[]) {
  return values.some(
    (candidate) => value.toLowerCase() === candidate.toLowerCase(),
  );
}
