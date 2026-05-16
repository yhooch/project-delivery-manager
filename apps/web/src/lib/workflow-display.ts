type Translator = (key: string) => string;

const DEFAULT_REASON_KEY_BY_TEXT: Record<string, string> = {
  工作项已超过截止时间: "OVERDUE",
  工作项处于阻塞状态: "BLOCKED",
  工作项处于待确认状态: "PENDING_CONFIRM",
  "Bug 处于待回归状态": "PENDING_REGRESSION",
  工作项状态长时间未变化: "STALE",
};

export function translateWorkflowStateName(
  t: Translator,
  state: { code?: string; name: string },
): string {
  return translateByStableCode(
    t,
    "common.workflowDefaults.states",
    state.code,
    state.name,
  );
}

export function translateWorkflowActionName(
  t: Translator,
  action: { code?: string; name: string },
): string {
  return translateByStableCode(
    t,
    "common.workflowDefaults.actions",
    action.code,
    action.name,
  );
}

export function translateWorkflowDefinitionName(
  t: Translator,
  workflow: { code?: string; name: string },
): string {
  return translateByStableCode(
    t,
    "common.workflowDefaults.definitions",
    workflow.code,
    workflow.name,
    "name",
  );
}

export function translateWorkflowDefinitionDescription(
  t: Translator,
  workflow: { code?: string; description?: string | null },
): string | undefined {
  if (!workflow.description) {
    return undefined;
  }

  return translateByStableCode(
    t,
    "common.workflowDefaults.definitions",
    workflow.code,
    workflow.description,
    "description",
  );
}

export function translateWorkflowFieldLabel(
  t: Translator,
  field: { key?: string; label: string },
): string {
  return translateByStableCode(
    t,
    "common.workflowDefaults.fields",
    field.key,
    field.label,
  );
}

export function translateExceptionReason(
  t: Translator,
  reason: string,
): string {
  const code = reason.trim().toUpperCase();
  if (/^[A-Z][A-Z0-9_]*$/u.test(code)) {
    return translateByStableCode(t, "common.exceptionReasons", code, reason);
  }

  const knownCode = DEFAULT_REASON_KEY_BY_TEXT[reason.trim()];
  if (knownCode) {
    return translateByStableCode(
      t,
      "common.exceptionReasons",
      knownCode,
      reason,
    );
  }

  return reason;
}

function translateByStableCode(
  t: Translator,
  namespace: string,
  code: string | undefined,
  fallback: string,
  property?: string,
): string {
  const normalized = code?.trim();
  if (!normalized) {
    return fallback;
  }

  const key = property
    ? `${namespace}.${normalized}.${property}`
    : `${namespace}.${normalized}`;
  try {
    const translated = t(key);
    return translated === key ? fallback : translated;
  } catch {
    return fallback;
  }
}
